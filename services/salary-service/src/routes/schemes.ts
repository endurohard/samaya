import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db';
import { authenticate, requireRole, HttpError } from '../middleware';

const router = Router();
router.use(authenticate);

const SCHEME_TYPES = ['rate', 'rate_plus_percent', 'percent_only'] as const;
const RATE_PERIODS = ['day', 'week', 'month'] as const;

const listSchema = z.object({
  master_id: z.string().uuid().optional(),
  as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
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
  effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
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
          effective_from, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, master_id, scheme_type,
                 rate_amount::float8 AS rate_amount, rate_period,
                 percent_services::float8 AS percent_services,
                 percent_goods::float8 AS percent_goods,
                 apply_discount,
                 guaranteed::float8 AS guaranteed,
                 effective_from, effective_to, notes, created_at`,
      [
        req.auth!.company_id, input.master_id, input.scheme_type,
        input.rate_amount, input.rate_period,
        input.percent_services, input.percent_goods, input.apply_discount,
        input.guaranteed, input.effective_from, input.notes ?? null,
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

export default router;
