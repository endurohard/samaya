import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db';
import { authenticate, requireRole, HttpError } from '../middleware';

const router = Router();
router.use(authenticate);

const listSchema = z.object({
  master_id: z.string().uuid().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
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
    if (q.from) {
      params.push(q.from);
      where += ` AND created_at >= $${params.length}::date`;
    }
    if (q.to) {
      params.push(q.to);
      where += ` AND created_at <= ($${params.length}::date + INTERVAL '1 day')`;
    }
    params.push(q.limit);
    const { rows } = await pool.query(
      `SELECT id, master_id, amount::float8 AS amount, period_from, period_to,
              source_kind, source, source_booking_id, note,
              created_by_user_id, created_at
       FROM salary.accruals
       WHERE ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length}`,
      params,
    );
    return res.json({ items: rows });
  } catch (e) { return next(e); }
});

const createSchema = z.object({
  master_id: z.string().uuid(),
  amount: z.number(),                  // signed: + начисление, − штраф
  source_kind: z.enum(['bonus', 'penalty', 'manual', 'auto_calc']).default('manual'),
  period_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  period_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  source: z.string().max(500).optional(),
  note: z.string().max(2000).optional(),
});

router.post('/', requireRole(['owner', 'admin']), async (req, res, next) => {
  try {
    const input = createSchema.parse(req.body);
    const { rows } = await pool.query(
      `INSERT INTO salary.accruals
         (company_id, master_id, amount, source_kind, source,
          period_from, period_to, note, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, master_id, amount::float8 AS amount, period_from, period_to,
                 source_kind, source, note, created_at`,
      [
        req.auth!.company_id, input.master_id, input.amount,
        input.source_kind, input.source ?? null,
        input.period_from ?? null, input.period_to ?? null,
        input.note ?? null, req.auth!.sub,
      ],
    );
    return res.status(201).json(rows[0]);
  } catch (e) { return next(e); }
});

// POST /api/salary/accruals/bulk — пачкой создать несколько начислений
const bulkSchema = z.object({
  items: z.array(createSchema).min(1).max(100),
});

router.post('/bulk', requireRole(['owner', 'admin']), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const input = bulkSchema.parse(req.body);
    await client.query('BEGIN');
    const ids: string[] = [];
    for (const it of input.items) {
      const { rows } = await client.query(
        `INSERT INTO salary.accruals
           (company_id, master_id, amount, source_kind, source,
            period_from, period_to, note, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          req.auth!.company_id, it.master_id, it.amount,
          it.source_kind, it.source ?? null,
          it.period_from ?? null, it.period_to ?? null,
          it.note ?? null, req.auth!.sub,
        ],
      );
      ids.push(rows[0].id);
    }
    await client.query('COMMIT');
    return res.status(201).json({ ids, count: ids.length });
  } catch (e) {
    await client.query('ROLLBACK');
    return next(e);
  } finally {
    client.release();
  }
});

router.delete('/:id', requireRole(['owner', 'admin']), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `DELETE FROM salary.accruals
       WHERE company_id = $1 AND id = $2 RETURNING id`,
      [req.auth!.company_id, req.params.id],
    );
    if (!rows[0]) return next(new HttpError(404, 'accrual not found'));
    return res.json({ ok: true });
  } catch (e) { return next(e); }
});

export default router;
