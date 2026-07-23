import { Router } from 'express';
import { z } from 'zod';
import { isoDate } from '../validators';
import { pool } from '../db';
import { authenticate, requireRole, HttpError } from '../middleware';

const router = Router();
router.use(authenticate);

const SCHEME_TYPES = ['rate', 'rate_plus_percent', 'percent_only'] as const;
const RATE_PERIODS = ['day', 'week', 'month'] as const;

const listSchema = z.object({
  master_id: z.string().uuid().optional(),
  as_of: isoDate().optional(),
});

router.get('/', async (req, res, next) => {
  try {
    const q = listSchema.parse(req.query);
    const params: unknown[] = [req.auth!.company_id];
    let where = `company_id = $1`;
    if (q.master_id) {
      params.push(q.master_id);
      where += ` AND master_id = $${params.length}`;
    }
    if (q.as_of) {
      params.push(q.as_of);
      where += ` AND effective_from <= $${params.length}`
             + ` AND (effective_to IS NULL OR effective_to >= $${params.length})`;
    }
    const { rows } = await pool.query(
      `SELECT id, master_id, scheme_type,
              rate_amount::float8 AS rate_amount, rate_period,
              percent_services::float8 AS percent_services,
              percent_goods::float8 AS percent_goods,
              apply_discount,
              guaranteed::float8 AS guaranteed,
              percent_company::float8 AS percent_company,
              percent_created::float8 AS percent_created,
              effective_from, effective_to, notes, created_at
       FROM salary.schemes
       WHERE ${where}
       ORDER BY master_id, effective_from DESC`,
      params,
    );
    return res.json({ items: rows });
  } catch (e) { return next(e); }
});

const createSchema = z.object({
  master_id: z.string().uuid(),
  scheme_type: z.enum(SCHEME_TYPES),
  rate_amount: z.number().min(0).default(0),
  rate_period: z.enum(RATE_PERIODS).default('month'),
  percent_services: z.number().min(0).max(100).default(0),
  percent_goods: z.number().min(0).max(100).default(0),
  apply_discount: z.boolean().default(false),
  guaranteed: z.number().min(0).default(0),
  // Проценты в объёме DIKIDI: от продаж всей компании и от записей, которые
  // сотрудник оформил (по manager_id записи).
  percent_company: z.number().min(0).max(100).default(0),
  percent_created: z.number().min(0).max(100).default(0),
  effective_from: isoDate(),
  notes: z.string().max(2000).optional(),
});

router.post('/', requireRole(['owner', 'admin']), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const input = createSchema.parse(req.body);
    await client.query('BEGIN');

    // Auto-close предыдущей открытой схемы для этого мастера, если перекрывается.
    await client.query(
      `UPDATE salary.schemes
       SET effective_to = ($3::date - INTERVAL '1 day')::date
       WHERE company_id = $1 AND master_id = $2
         AND effective_from <= $3::date
         AND effective_to IS NULL`,
      [req.auth!.company_id, input.master_id, input.effective_from],
    );

    const { rows } = await client.query(
      `INSERT INTO salary.schemes
         (company_id, master_id, scheme_type, rate_amount, rate_period,
          percent_services, percent_goods, apply_discount, guaranteed,
          percent_company, percent_created, effective_from, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id, master_id, scheme_type,
                 rate_amount::float8 AS rate_amount, rate_period,
                 percent_services::float8 AS percent_services,
                 percent_goods::float8 AS percent_goods,
                 apply_discount,
                 guaranteed::float8 AS guaranteed,
                 percent_company::float8 AS percent_company,
                 percent_created::float8 AS percent_created,
                 effective_from, effective_to, notes, created_at`,
      [
        req.auth!.company_id, input.master_id, input.scheme_type,
        input.rate_amount, input.rate_period,
        input.percent_services, input.percent_goods, input.apply_discount,
        input.guaranteed, input.percent_company, input.percent_created,
        input.effective_from, input.notes ?? null,
      ],
    );
    await client.query('COMMIT');
    return res.status(201).json(rows[0]);
  } catch (e: unknown) {
    await client.query('ROLLBACK');
    if ((e as { code?: string }).code === '23P01') {
      return next(new HttpError(409, 'overlapping scheme range for master', 'OVERLAP'));
    }
    return next(e);
  } finally {
    client.release();
  }
});

router.delete('/:id', requireRole(['owner', 'admin']), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `DELETE FROM salary.schemes
       WHERE company_id = $1 AND id = $2 RETURNING id`,
      [req.auth!.company_id, req.params.id],
    );
    if (!rows[0]) return next(new HttpError(404, 'scheme not found'));
    return res.json({ ok: true });
  } catch (e) { return next(e); }
});

// ===== Пер-услуга вознаграждение мастера («Детальные настройки» DIKIDI) =====
router.get('/service-rates/:masterId', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT service_id,
              percent::float8 AS percent,
              fixed_amount::float8 AS fixed_amount
       FROM salary.master_service_rates
       WHERE company_id = $1 AND master_id = $2`,
      [req.auth!.company_id, req.params.masterId],
    );
    return res.json({ items: rows });
  } catch (e) { return next(e); }
});

const svcRatesSchema = z.object({
  items: z.array(z.object({
    service_id: z.string().uuid(),
    percent: z.number().min(0).max(100).nullable().optional(),
    fixed_amount: z.number().min(0).nullable().optional(),
  })).max(500),
});

router.put('/service-rates/:masterId', requireRole(['owner', 'admin']), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const input = svcRatesSchema.parse(req.body);
    const companyId = req.auth!.company_id;
    await client.query('BEGIN');
    // Полная замена набора: пустые строки (ни процента, ни ставки) просто
    // не сохраняются — для них действует общий процент схемы.
    await client.query(
      `DELETE FROM salary.master_service_rates WHERE company_id = $1 AND master_id = $2`,
      [companyId, req.params.masterId],
    );
    const rows = input.items.filter((it) =>
      (it.percent !== null && it.percent !== undefined) ||
      (it.fixed_amount !== null && it.fixed_amount !== undefined));
    for (const it of rows) {
      await client.query(
        `INSERT INTO salary.master_service_rates
           (company_id, master_id, service_id, percent, fixed_amount)
         VALUES ($1, $2, $3, $4, $5)`,
        [companyId, req.params.masterId, it.service_id,
         it.percent ?? null, it.fixed_amount ?? null],
      );
    }
    await client.query('COMMIT');
    return res.json({ saved: rows.length });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => { /* мёртвое соединение */ });
    return next(e);
  } finally {
    client.release();
  }
});

export default router;
