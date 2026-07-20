import { Router } from 'express';
import { z } from 'zod';
import { isoDate } from '../validators';
import { pool } from '../db';
import { config } from '../config';
import { authenticate, HttpError } from '../middleware';
import { daysBetween, daysInMonthOf, computeMasterSalary } from '../calculate.service';

const router = Router();
router.use(authenticate);

interface BookingService {
  service_id: string;
  price: number;
}

interface BookingRow {
  master_id: string;
  manager_id?: string | null;
  total_price: number;
  status: string;
  services?: BookingService[];
}

async function fetchCompletedBookings(
  token: string,
  from: string,
  to: string,
): Promise<BookingRow[]> {
  const url = `${config.BOOKING_SERVICE_URL}/api/bookings?from=${from}&to=${to}&status=completed`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new HttpError(502, `booking-service ${r.status}`, 'UPSTREAM');
  const j: unknown = await r.json();
  const items = Array.isArray((j as { items?: unknown[] }).items)
    ? (j as { items: BookingRow[] }).items
    : [];
  return items.filter((b) => b.status === 'completed');
}

const calcSchema = z.object({
  from: isoDate(),
  to: isoDate(),
  master_id: z.string().uuid().optional(),
});

router.get('/', async (req, res, next) => {
  try {
    const q = calcSchema.parse(req.query);
    const calendarDays = daysBetween(q.from, q.to);
    const companyId = req.auth!.company_id;

    // Схемы начисления
    const schemeRows = await pool.query(
      `WITH ranked AS (
         SELECT s.*,
                ROW_NUMBER() OVER (PARTITION BY master_id ORDER BY effective_from DESC) AS rn
         FROM salary.schemes s
         WHERE company_id = $1
           AND effective_from <= $2::date
           AND (effective_to IS NULL OR effective_to >= $2::date)
       )
       SELECT id, master_id, scheme_type,
              rate_amount::float8 AS rate_amount, rate_period,
              percent_services::float8 AS percent_services,
              percent_goods::float8 AS percent_goods,
              apply_discount,
              guaranteed::float8 AS guaranteed
       FROM ranked WHERE rn = 1`,
      [companyId, q.to],
    );

    // Список мастеров
    const masters = await pool.query(
      `SELECT id, display_name AS name, specialization, is_active,
              provides_services, category, position, in_commission_pool
       FROM salons.masters
       WHERE company_id = $1 AND is_active = TRUE`
      + (q.master_id ? ` AND id = $2` : ''),
      q.master_id ? [companyId, q.master_id] : [companyId],
    );

    // Завершённые записи с услугами
    const token = (req.headers.authorization || '').slice(7);
    // Не глушим сбой booking-service: иначе зарплаты молча посчитаются с нулевой
    // выручкой и 200 OK. Ошибка апстрима → 502, пусть вызывающий повторит.
    const bookings = await fetchCompletedBookings(token, q.from, q.to);
    const bookingTotals = new Map<string, number>();
    for (const b of bookings) {
      const cur = bookingTotals.get(b.master_id) || 0;
      bookingTotals.set(b.master_id, cur + Number(b.total_price));
    }

    // Правила комиссий (активные на конец периода)
    const commRules = await pool.query(
      `SELECT service_id, category_id, staff_group_id,
              commission_type, amount::float8 AS amount
       FROM salary.service_commissions
       WHERE company_id = $1
         AND effective_from <= $2::date
         AND (effective_to IS NULL OR effective_to >= $2::date)`,
      [companyId, q.to],
    );

    // Категория каждой услуги — правила можно задавать на всю группу услуг
    // («Лазеры»), а не только на конкретную позицию прайса.
    const svcCategory = new Map<string, string | null>();
    const catRes = await pool.query(
      `SELECT id, category_id FROM salons.services WHERE company_id = $1`,
      [companyId],
    );
    for (const s of catRes.rows) svcCategory.set(s.id, s.category_id);

    // Состав групп сотрудников.
    const groupMembers = new Map<string, string[]>();
    const gmRes = await pool.query(
      `SELECT g.id AS group_id, m.master_id
       FROM salary.staff_groups g
       JOIN salary.staff_group_members m ON m.group_id = g.id
       WHERE g.company_id = $1`,
      [companyId],
    );
    for (const row of gmRes.rows) {
      const list = groupMembers.get(row.group_id) || [];
      list.push(row.master_id);
      groupMembers.set(row.group_id, list);
    }

    // Индексируем правила: percent (в пул) и fixed (оформившему).
    // Приоритет при поиске: конкретная услуга → её категория → правило «на всё».
    interface PctRule { amount: number; groupId: string | null }
    const percentByService = new Map<string, PctRule>();
    const percentByCategory = new Map<string, PctRule>();
    let percentCatchall: PctRule = { amount: 0, groupId: null };
    const fixedRules = new Map<string | null, number>();
    let fixedCatchall = 0;
    for (const rule of commRules.rows) {
      if (rule.commission_type === 'percent') {
        const r: PctRule = { amount: rule.amount, groupId: rule.staff_group_id ?? null };
        if (rule.service_id) percentByService.set(rule.service_id, r);
        else if (rule.category_id) percentByCategory.set(rule.category_id, r);
        else percentCatchall = r;
      } else {
        if (rule.service_id) fixedRules.set(rule.service_id, rule.amount);
        else fixedCatchall = rule.amount;
      }
    }

    const findPercentRule = (serviceId: string): PctRule => {
      const byService = percentByService.get(serviceId);
      if (byService) return byService;
      const cat = svcCategory.get(serviceId);
      if (cat) {
        const byCat = percentByCategory.get(cat);
        if (byCat) return byCat;
      }
      return percentCatchall;
    };

    // Пул процентных комиссий (идёт всем участникам пула поровну)
    let totalPercentPool = 0;
    // Пулы, адресованные конкретной группе сотрудников: group_id → сумма.
    // Процент считается на группу целиком и делится между её участниками —
    // это не «по 2% каждому», иначе расход вырос бы кратно размеру группы.
    const groupPools = new Map<string, number>();
    // Фиксированные комиссии по менеджеру записи
    const fixedByManager = new Map<string, number>();

    for (const booking of bookings) {
      for (const svc of (booking.services || [])) {
        const svcPrice = Number(svc.price);

        // % комиссия → в пул: общий или групповой
        const rule = findPercentRule(svc.service_id);
        const pct = rule.amount;
        if (pct > 0) {
          const sum = svcPrice * (pct / 100);
          if (rule.groupId) {
            groupPools.set(rule.groupId, (groupPools.get(rule.groupId) || 0) + sum);
          } else {
            totalPercentPool += sum;
          }
        }

        // Фиксированная → тому менеджеру, кто оформил запись
        if (booking.manager_id) {
          const fixed = fixedRules.get(svc.service_id) ?? fixedCatchall;
          if (fixed > 0) {
            fixedByManager.set(
              booking.manager_id,
              (fixedByManager.get(booking.manager_id) || 0) + fixed,
            );
          }
        }
      }
    }
    totalPercentPool = Math.round(totalPercentPool);

    // Отработанные дни для техничек
    const cleanerMasterIds = masters.rows
      .filter((m) => !m.provides_services)
      .map((m) => m.id);
    const workedDaysMap = new Map<string, number>();
    if (cleanerMasterIds.length > 0) {
      const wdRes = await pool.query(
        `SELECT master_id, COUNT(*)::int AS worked_days
         FROM salons.master_schedules
         WHERE master_id = ANY($1::uuid[])
           AND work_date >= $2::date
           AND work_date <= $3::date
           AND is_day_off = FALSE
         GROUP BY master_id`,
        [cleanerMasterIds, q.from, q.to],
      );
      for (const row of wdRes.rows) workedDaysMap.set(row.master_id, row.worked_days);
    }

    // Участники % пула — только с in_commission_pool=true
    const poolMembers = masters.rows.filter((m) => m.in_commission_pool);
    const managerCount = poolMembers.length;

    // Делим пул поровну методом наибольшего остатка: Σ долей == пул (без утечки копеек).
    const poolShares = new Map<string, number>();
    const splitEqually = (pool: number, memberIds: string[], into: Map<string, number>) => {
      const n = memberIds.length;
      if (n === 0 || pool <= 0) return;
      const amount = Math.round(pool);
      const base = Math.floor(amount / n);
      let remainder = amount - base * n;
      // Сортировка по id — чтобы «лишние» копейки доставались стабильно одним
      // и тем же людям, а не прыгали между пересчётами одного периода.
      for (const id of [...memberIds].sort()) {
        let share = base;
        if (remainder > 0) { share += 1; remainder -= 1; }
        into.set(id, (into.get(id) || 0) + share);
      }
    };

    if (managerCount > 0 && totalPercentPool > 0) {
      splitEqually(totalPercentPool, poolMembers.map((m) => m.id), poolShares);
    }

    // Групповые пулы: каждый делится только между участниками своей группы.
    const knownMasterIds = new Set(masters.rows.map((m) => m.id));
    for (const [groupId, pool] of groupPools) {
      // Уволенных/удалённых из списка мастеров в делёж не берём — иначе часть
      // суммы уйдёт в никуда и Σ долей не сойдётся с пулом.
      const members = (groupMembers.get(groupId) || []).filter((id) => knownMasterIds.has(id));
      splitEqually(pool, members, poolShares);
    }

    // Делитель для месячной ставки — реальное число дней месяца периода (не фикс. 30).
    const monthDivisor = daysInMonthOf(q.from);

    const schemeMap = new Map<string, typeof schemeRows.rows[0]>();
    for (const s of schemeRows.rows) schemeMap.set(s.master_id, s);

    const items = masters.rows.map((m) => {
      const scheme = schemeMap.get(m.id) ?? null;
      const isCleaner =
        !m.provides_services &&
        ((m.category || '').toLowerCase() === 'техничка' ||
         (m.position || '').toLowerCase() === 'техничка');
      const isManager = !m.provides_services && !isCleaner;
      const isPoolMember = !!m.in_commission_pool;

      const workedDays = workedDaysMap.get(m.id) ?? 0;
      const effectiveDays = isCleaner ? workedDays : calendarDays;
      const sales = m.provides_services ? (bookingTotals.get(m.id) || 0) : 0;
      // Выручка по товарам мастера — источника продаж товаров пока нет (0).
      const goodsTotal = 0;

      const { rate, pct_services, pct_goods, guaranteed, total: baseTotal } =
        computeMasterSalary(scheme, sales, effectiveDays, monthDivisor, goodsTotal);

      // % пул делится методом наибольшего остатка (Σ == пулу).
      // Условие на in_commission_pool здесь не нужно: в poolShares попадают
      // только те, кому доля положена, — участники общего пула и члены групп,
      // адресованных правилом. Флаг отсёк бы групповые доли у тех, кто в общем
      // пуле не состоит, — а именно так и настраивают отдельные группы.
      const percentShare = poolShares.get(m.id) ?? 0;
      // Фиксированная — только тому, кто оформил (любой не-мастер)
      const fixedShare = isManager ? Math.round(fixedByManager.get(m.id) || 0) : 0;
      const commissionTotal = percentShare + fixedShare;
      const total = baseTotal + commissionTotal;

      return {
        master_id: m.id,
        master_name: m.name,
        master_role: m.specialization || m.position || '',
        provides_services: m.provides_services,
        is_cleaner: isCleaner,
        is_manager: isManager,
        in_commission_pool: isPoolMember,
        scheme_id: scheme?.id ?? null,
        scheme_type: scheme?.scheme_type ?? null,
        sales_total: sales,
        worked_days: isCleaner ? workedDays : null,
        commission_percent_share: percentShare,
        commission_fixed_share: fixedShare,
        commission_total: commissionTotal,
        rate, pct_services, pct_goods, pct_salon: 0, guaranteed, total,
      };
    });

    return res.json({
      from: q.from,
      to: q.to,
      days: calendarDays,
      total_percent_commission_pool: totalPercentPool,
      manager_count: managerCount,
      items,
    });
  } catch (e) { return next(e); }
});

export default router;
