import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db';
import { authenticate, requireRole, HttpError } from '../middleware';

const router = Router();
router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, start_time, end_time, dow_mask, is_default, created_at
       FROM salons.schedule_templates
       WHERE company_id = $1
       ORDER BY is_default DESC, name`,
      [req.auth!.company_id],
    );
    return res.json({ items: rows });
  } catch (e) { return next(e); }
});

const createSchema = z.object({
  name: z.string().min(1).max(100),
  start_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  end_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  dow_mask: z.number().int().min(0).max(127).default(127),
  is_default: z.boolean().default(false),
});

router.post('/', requireRole(['owner', 'admin']), async (req, res, next) => {
  try {
    const input = createSchema.parse(req.body);
    if (input.is_default) {
      // Сбрасываем default у других шаблонов компании.
      await pool.query(
        `UPDATE salons.schedule_templates SET is_default = FALSE
         WHERE company_id = $1 AND is_default = TRUE`,
        [req.auth!.company_id],
      );
    }
    const { rows } = await pool.query(
      `INSERT INTO salons.schedule_templates
         (company_id, name, start_time, end_time, dow_mask, is_default)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, start_time, end_time, dow_mask, is_default, created_at`,
      [req.auth!.company_id, input.name, input.start_time, input.end_time, input.dow_mask, input.is_default],
    );
    return res.status(201).json(rows[0]);
  } catch (e: unknown) {
    if ((e as { code?: string }).code === '23505') {
      return next(new HttpError(409, 'template name already exists', 'DUP_NAME'));
    }
    return next(e);
  }
});

const patchSchema = createSchema.partial();

router.patch('/:id', requireRole(['owner', 'admin']), async (req, res, next) => {
  try {
    const input = patchSchema.parse(req.body);
    const fields: string[] = [];
    const values: unknown[] = [req.auth!.company_id, req.params.id];
    for (const [k, v] of Object.entries(input)) {
      if (v === undefined) continue;
      values.push(v);
      fields.push(`${k} = $${values.length}`);
    }
    if (!fields.length) return res.status(400).json({ error: 'no fields to update' });
    if (input.is_default === true) {
      await pool.query(
        `UPDATE salons.schedule_templates SET is_default = FALSE
         WHERE company_id = $1 AND is_default = TRUE AND id != $2`,
        [req.auth!.company_id, req.params.id],
      );
    }
    const { rows } = await pool.query(
      `UPDATE salons.schedule_templates SET ${fields.join(', ')}
       WHERE company_id = $1 AND id = $2
       RETURNING id, name, start_time, end_time, dow_mask, is_default, created_at`,
      values,
    );
    if (!rows[0]) return next(new HttpError(404, 'template not found'));
    return res.json(rows[0]);
  } catch (e) { return next(e); }
});

router.delete('/:id', requireRole(['owner', 'admin']), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `DELETE FROM salons.schedule_templates
       WHERE company_id = $1 AND id = $2 RETURNING id`,
      [req.auth!.company_id, req.params.id],
    );
    if (!rows[0]) return next(new HttpError(404, 'template not found'));
    return res.json({ ok: true });
  } catch (e) { return next(e); }
});

export default router;
