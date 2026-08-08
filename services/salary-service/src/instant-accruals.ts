// Мгновенные начисления по оплаченной записи.
//
// Часть зарплаты привязана к конкретной записи и известна сразу после оплаты:
//   • исполнителю — процент с его услуг и персональные ставки по услугам;
//   • менеджеру, оформившему запись, — фиксированная комиссия и процент
//     от созданных записей.
// Их начисляем сразу, чтобы сотрудник видел заработок в день работы, а не
// в конце месяца.
//
// Остальное остаётся на расчёт периода: доля из процентного пула (её нельзя
// посчитать по одной записи — пул делится между участниками), ставка за
// смены, процент от выручки компании и гарантированная сумма.
//
// Воркер опрашивает базу напрямую: у фоновой задачи нет пользовательского
// токена, а booking-service живёт в той же БД. Заявка на обработку — вставка
// в salary.booking_accrued: выиграл вставку, значит запись твоя.

import type { PoolClient } from 'pg';
import { pool } from './db';
import { discountRatio } from './calculate.service';

export const SOURCE_EXECUTOR = 'booking_executor';
export const SOURCE_MANAGER = 'booking_manager';

interface PctRule { amount: number; groupId: string | null }

interface CompanyRules {
  percentByService: Map<string, PctRule>;
  percentByCategory: Map<string, PctRule>;
  percentCatchall: PctRule;
  fixedRules: Map<string, number>;
  fixedCatchall: number;
  svcCategory: Map<string, string | null>;
  svcRates: Map<string, { percent: number | null; fixed: number | null }>;
  memberOf: Set<string>;
}

interface SchemeRow {
  scheme_type: string;
  percent_services: number;
  percent_created: number;
}

export interface BookingAccrual {
  master_id: string;
  amount: number;
  source: typeof SOURCE_EXECUTOR | typeof SOURCE_MANAGER;
}

interface BookingForAccrual {
  id: string;
  company_id: string;
  master_id: string;
  manager_id: string | null;
  discount_amount: number;
  work_date: string;
  services: Array<{ service_id: string; price: number; manager_id: string | null }>;
}

// Правила компании на дату. Грузим один раз на пачку записей.
async function loadRules(client: PoolClient, companyId: string, onDate: string): Promise<CompanyRules> {
  const [comm, cats, rates, members] = await Promise.all([
    client.query(
      `SELECT service_id, category_id, staff_group_id, commission_type, amount::float8 AS amount
       FROM salary.service_commissions
       WHERE company_id = $1 AND effective_from <= $2::date
         AND (effective_to IS NULL OR effective_to >= $2::date)`,
      [companyId, onDate],
    ),
    client.query(`SELECT id, category_id FROM salons.services WHERE company_id = $1`, [companyId]),
    client.query(
      `SELECT master_id, service_id, percent::float8 AS percent, fixed_amount::float8 AS fixed
       FROM salary.master_service_rates WHERE company_id = $1`,
      [companyId],
    ),
    client.query(
      `SELECT g.id AS group_id, m.master_id
       FROM salary.staff_groups g
       JOIN salary.staff_group_members m ON m.group_id = g.id
       WHERE g.company_id = $1`,
      [companyId],
    ),
  ]);

  const rules: CompanyRules = {
    percentByService: new Map(),
    percentByCategory: new Map(),
    percentCatchall: { amount: 0, groupId: null },
    fixedRules: new Map(),
    fixedCatchall: 0,
    svcCategory: new Map(),
    svcRates: new Map(),
    memberOf: new Set(members.rows.map((r) => `${r.group_id}:${r.master_id}`)),
  };
  for (const s of cats.rows) rules.svcCategory.set(s.id, s.category_id);
  for (const r of rates.rows) {
    rules.svcRates.set(`${r.master_id}:${r.service_id}`, { percent: r.percent, fixed: r.fixed });
  }
  for (const rule of comm.rows) {
    if (rule.commission_type === 'percent') {
      const r: PctRule = { amount: rule.amount, groupId: rule.staff_group_id ?? null };
      if (rule.service_id) rules.percentByService.set(rule.service_id, r);
      else if (rule.category_id) rules.percentByCategory.set(rule.category_id, r);
      else rules.percentCatchall = r;
    } else if (rule.service_id) {
      rules.fixedRules.set(rule.service_id, rule.amount);
    } else {
      rules.fixedCatchall = rule.amount;
    }
  }
  return rules;
}

function findPercentRule(rules: CompanyRules, serviceId: string): PctRule {
  const byService = rules.percentByService.get(serviceId);
  if (byService) return byService;
  const cat = rules.svcCategory.get(serviceId);
  if (cat) {
    const byCat = rules.percentByCategory.get(cat);
    if (byCat) return byCat;
  }
  return rules.percentCatchall;
}

async function schemeFor(
  client: PoolClient, companyId: string, masterId: string, onDate: string,
): Promise<SchemeRow | null> {
  const { rows } = await client.query(
    `SELECT scheme_type,
            percent_services::float8 AS percent_services,
            percent_created::float8  AS percent_created
     FROM salary.schemes
     WHERE company_id = $1 AND master_id = $2
       AND effective_from <= $3::date
       AND (effective_to IS NULL OR effective_to >= $3::date)
     ORDER BY effective_from DESC
     LIMIT 1`,
    [companyId, masterId, onDate],
  );
  return rows[0] ?? null;
}

// Что причитается по одной записи: исполнителю и менеджеру, оформившему её.
export async function computeBookingAccruals(
  client: PoolClient, b: BookingForAccrual, rules: CompanyRules,
): Promise<BookingAccrual[]> {
  const bookingSum = b.services.reduce((a, s) => a + Number(s.price), 0);
  const ratio = discountRatio(bookingSum, Number(b.discount_amount || 0));

  let execBase = 0;      // услуги под общий процент схемы
  let execOverride = 0;  // услуги с персональной ставкой
  // Базы менеджеров держим по каждому: позиции одной записи могут быть
  // оформлены разными людьми, и каждому причитается своё.
  const managerFixed = new Map<string, number>();
  const managerCreatedBase = new Map<string, number>();

  for (const svc of b.services) {
    const svcPrice = Number(svc.price) * (1 - ratio);
    const rule = findPercentRule(rules, svc.service_id);

    // «Либо групповое, либо личное»: услуга, покрытая процентным правилом
    // своей группы, не даёт участнику ещё и личный процент — иначе за одну
    // услугу человек получит и долю пула, и свой процент.
    const execCovered = !!(rule.groupId && rule.amount > 0
      && rules.memberOf.has(`${rule.groupId}:${b.master_id}`));
    if (!execCovered) {
      const orate = rules.svcRates.get(`${b.master_id}:${svc.service_id}`);
      if (orate) {
        execOverride += orate.fixed !== null && orate.fixed !== undefined
          ? Number(orate.fixed)
          : svcPrice * (Number(orate.percent) / 100);
      } else {
        execBase += svcPrice;
      }
    }

    // Оформивший эту позицию; пусто — менеджер всей записи.
    const svcManager = svc.manager_id ?? b.manager_id ?? null;
    if (svcManager) {
      const fixed = rules.fixedRules.get(svc.service_id) ?? rules.fixedCatchall;
      managerFixed.set(svcManager, (managerFixed.get(svcManager) || 0) + fixed);
      const coveredByOwnGroup = !!(rule.groupId && rule.amount > 0
        && rules.memberOf.has(`${rule.groupId}:${svcManager}`));
      if (!coveredByOwnGroup) {
        managerCreatedBase.set(svcManager, (managerCreatedBase.get(svcManager) || 0) + svcPrice);
      }
    }
  }

  const out: BookingAccrual[] = [];

  const execScheme = await schemeFor(client, b.company_id, b.master_id, b.work_date);
  const usesPct = execScheme?.scheme_type === 'percent_only'
    || execScheme?.scheme_type === 'rate_plus_percent';
  const execAmount = Math.round(
    (usesPct ? execBase * Number(execScheme?.percent_services || 0) / 100 : 0) + execOverride,
  );
  if (execAmount > 0) out.push({ master_id: b.master_id, amount: execAmount, source: SOURCE_EXECUTOR });

  for (const managerId of new Set([...managerFixed.keys(), ...managerCreatedBase.keys()])) {
    const mgrScheme = await schemeFor(client, b.company_id, managerId, b.work_date);
    const created = Math.round(
      (managerCreatedBase.get(managerId) || 0) * Number(mgrScheme?.percent_created || 0) / 100,
    );
    const mgrAmount = Math.round(managerFixed.get(managerId) || 0) + created;
    // Исполнитель, оформивший запись сам себе, получает обе строки — это
    // разные основания (за работу и за оформление), и так же считает
    // расчёт периода.
    if (mgrAmount > 0) out.push({ master_id: managerId, amount: mgrAmount, source: SOURCE_MANAGER });
  }

  return out;
}

// Обрабатывает пачку оплаченных записей, ещё не попавших в зарплату.
// Возвращает число обработанных записей.
export async function processPaidBookings(limit = 50): Promise<number> {
  const { rows: pending } = await pool.query<{ id: string }>(
    `SELECT b.id
     FROM bookings.bookings b
     LEFT JOIN salary.booking_accrued ba ON ba.booking_id = b.id
     WHERE b.status = 'completed'
       AND b.paid_at IS NOT NULL
       AND b.paid_at >= NOW() - INTERVAL '90 days'
       AND ba.booking_id IS NULL
     ORDER BY b.paid_at
     LIMIT $1`,
    [limit],
  );
  if (!pending.length) return 0;

  let processed = 0;
  const rulesCache = new Map<string, CompanyRules>();

  for (const { id } of pending) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Заявка на обработку: кто вставил строку, тот и считает запись.
      const claim = await client.query(
        `INSERT INTO salary.booking_accrued (company_id, booking_id)
         SELECT company_id, id FROM bookings.bookings WHERE id = $1
         ON CONFLICT (booking_id) DO NOTHING
         RETURNING booking_id`,
        [id],
      );
      if (!claim.rows.length) { await client.query('ROLLBACK'); continue; }

      const bRes = await client.query(
        `SELECT b.id, b.company_id, b.master_id, b.manager_id,
                b.discount_amount::float8 AS discount_amount,
                (b.paid_at AT TIME ZONE 'UTC')::date::text AS work_date,
                COALESCE(json_agg(json_build_object(
                  'service_id', bs.service_id, 'price', bs.price::float8,
                  'manager_id', bs.manager_id
                )) FILTER (WHERE bs.service_id IS NOT NULL), '[]'::json) AS services
         FROM bookings.bookings b
         LEFT JOIN bookings.booking_services bs ON bs.booking_id = b.id
         WHERE b.id = $1
         GROUP BY b.id`,
        [id],
      );
      const b = bRes.rows[0] as BookingForAccrual | undefined;
      if (!b || !b.master_id) { await client.query('COMMIT'); processed++; continue; }

      const cacheKey = `${b.company_id}:${b.work_date}`;
      let rules = rulesCache.get(cacheKey);
      if (!rules) {
        rules = await loadRules(client, b.company_id, b.work_date);
        rulesCache.set(cacheKey, rules);
      }

      const accruals = await computeBookingAccruals(client, b, rules);
      let total = 0;
      for (const a of accruals) {
        await client.query(
          `INSERT INTO salary.accruals
             (company_id, master_id, amount, source_kind, source, source_booking_id,
              period_from, period_to, note)
           VALUES ($1, $2, $3, 'auto_calc', $4, $5, $6::date, $6::date, $7)
           ON CONFLICT DO NOTHING`,
          [b.company_id, a.master_id, a.amount, a.source, b.id, b.work_date,
           a.source === SOURCE_EXECUTOR ? 'За выполненную услугу' : 'За оформление записи'],
        );
        total += a.amount;
      }
      await client.query(
        `UPDATE salary.booking_accrued SET accrued_total = $2 WHERE booking_id = $1`,
        [b.id, total],
      );
      await client.query('COMMIT');
      processed++;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }
  return processed;
}
