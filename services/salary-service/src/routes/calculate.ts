import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db';
import { config } from '../config';
import { authenticate, HttpError } from '../middleware';
import { daysBetween, computeMasterSalary } from '../calculate.service';

const router = Router();
router.use(authenticate);

interface BookingRow {
  master_id: string;
  total_price: number;
  status: string;
}

async function fetchCompletedBookings(
  token: string,
  from: string,
  to: string,
): Promise<BookingRow[]> {
  const url = `${config.BOOKING_SERVICE_URL}/api/bookings?from=${from}&to=${to}&status=completed`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) {
    throw new HttpError(502, `booking-service ${r.status}`, 'UPSTREAM');
  }
  const j: unknown = await r.json();
  const items = Array.isArray((j as { items?: unknown[] }).items)
    ? (j as { items: BookingRow[] }).items
    : [];
  return items.filter((b) => b.status === 'completed');
}

const calcSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  master_id: z.string().uuid().optional(),
});

router.get('/', async (req, res, next) => {
  try {
    const q = calcSchema.parse(req.query);
    const days = daysBetween(q.from, q.to);
    const companyId = req.auth!.company_id;

    // Active scheme per master at q.to (или последняя действующая в диапазоне).
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

    // Список мастеров (имена) — для красивого ответа.
    const masters = await pool.query(
      `SELECT id, display_name AS name, specialization, is_active
       FROM salons.masters
       WHERE company_id = $1` + (q.master_id ? ` AND id = $2` : ''),
      q.master_id ? [companyId, q.master_id] : [companyId],
    );

    // Bookings → группировка по master_id, сумма total_price.
    const token = (req.headers.authorization || '').slice(7);
    let bookingTotals = new Map<string, number>();
    try {
      const bookings = await fetchCompletedBookings(token, q.from, q.to);
      for (const b of bookings) {
        const cur = bookingTotals.get(b.master_id) || 0;
        bookingTotals.set(b.master_id, cur + Number(b.total_price));
      }
    } catch (e) {
      // booking-service down → возвращаем calc без процентов, не фейлим всё.
      bookingTotals = new Map();
    }

    const schemeMap = new Map<string, typeof schemeRows.rows[0]>();
    for (const s of schemeRows.rows) schemeMap.set(s.master_id, s);

    const items = masters.rows.map((m) => {
      const scheme = schemeMap.get(m.id) ?? null;
      const sales = bookingTotals.get(m.id) || 0;
      const { rate, pct_services, guaranteed, total } = computeMasterSalary(scheme, sales, days);
      return {
        master_id: m.id,
        master_name: m.name,
        master_role: m.specialization || '',
        scheme_id: scheme?.id ?? null,
        scheme_type: scheme?.scheme_type ?? null,
        sales_total: sales,
        rate, pct_services, pct_salon: 0, guaranteed, total,
      };
    });

    return res.json({
      from: q.from,
      to: q.to,
      days,
      items,
    });
  } catch (e) { return next(e); }
});

export default router;
