import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db';
import { authenticate, requireRole, HttpError } from '../middleware';

const router = Router();
router.use(authenticate);

const querySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

router.get('/:masterId', async (req, res, next) => {
  try {
    const q = querySchema.parse(req.query);
    const { rows } = await pool.query(
      `SELECT id, master_id, work_date::text AS work_date,
              start_time::text AS start_time, end_time::text AS end_time, is_day_off
       FROM salons.master_schedules
       WHERE company_id = $1 AND master_id = $2
         AND work_date >= $3::date AND work_date <= $4::date
       ORDER BY work_date`,
      [req.auth!.company_id, req.params.masterId, q.from, q.to],
    );
    return res.json({ items: rows });
  } catch (e) { return next(e); }
});

const itemSchema = z.object({
  work_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  is_day_off: z.boolean().optional().default(false),
  start_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  end_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
}).refine(
  (d) => d.is_day_off === true || (d.start_time !== undefined && d.end_time !== undefined),
  { message: 'start_time and end_time required when is_day_off=false' },
);

const bulkSchema = z.object({
  items: z.array(itemSchema).min(1).max(366),
});

router.put('/:masterId', requireRole(['owner', 'admin']), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { items } = bulkSchema.parse(req.body);
    await client.query('BEGIN');

    const m = await client.query(
      `SELECT id FROM salons.masters WHERE company_id = $1 AND id = $2`,
      [req.auth!.company_id, req.params.masterId],
    );
    if (!m.rows[0]) throw new HttpError(404, 'master not found');

    for (const it of items) {
      await client.query(
        `INSERT INTO salons.master_schedules
           (company_id, master_id, work_date, start_time, end_time, is_day_off)
         VALUES ($1, $2, $3::date, $4::time, $5::time, $6)
         ON CONFLICT (master_id, work_date) DO UPDATE SET
           start_time = EXCLUDED.start_time,
           end_time   = EXCLUDED.end_time,
           is_day_off = EXCLUDED.is_day_off`,
        [
          req.auth!.company_id,
          req.params.masterId,
          it.work_date,
          it.is_day_off ? null : it.start_time,
          it.is_day_off ? null : it.end_time,
          it.is_day_off,
        ],
      );
    }

    await client.query('COMMIT');
    return res.json({ updated: items.length });
  } catch (e) {
    await client.query('ROLLBACK');
    return next(e);
  } finally {
    client.release();
  }
});

export default router;
