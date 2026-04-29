import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db';
import { authenticate, requireRole, HttpError } from '../middleware';

const router = Router();
router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, sort_order, created_at, updated_at
       FROM salons.service_categories
       WHERE company_id = $1
       ORDER BY sort_order, name`,
      [req.auth!.company_id],
    );
    return res.json({ items: rows });
  } catch (e) { return next(e); }
});

const createSchema = z.object({
  name: z.string().min(1).max(100),
  sort_order: z.number().int().optional(),
});

router.post('/', requireRole(['owner', 'admin']), async (req, res, next) => {
  try {
    const input = createSchema.parse(req.body);
    const { rows } = await pool.query(
      `INSERT INTO salons.service_categories (company_id, name, sort_order)
       VALUES ($1, $2, $3) RETURNING *`,
      [req.auth!.company_id, input.name, input.sort_order ?? 0],
    );
    return res.status(201).json(rows[0]);
  } catch (e: unknown) {
    if ((e as { code?: string }).code === '23505') {
      return next(new HttpError(409, 'category name already exists', 'CATEGORY_EXISTS'));
    }
    return next(e);
  }
});

const updateSchema = createSchema.partial();

router.patch('/:id', requireRole(['owner', 'admin']), async (req, res, next) => {
  try {
    const input = updateSchema.parse(req.body);
    const fields: string[] = [];
    const values: unknown[] = [req.auth!.company_id, req.params.id];
    if (input.name !== undefined) {
      values.push(input.name);
      fields.push(`name = $${values.length}`);
    }
    if (input.sort_order !== undefined) {
      values.push(input.sort_order);
      fields.push(`sort_order = $${values.length}`);
    }
    if (fields.length === 0) return res.status(400).json({ error: 'no fields to update' });
    const { rows } = await pool.query(
      `UPDATE salons.service_categories SET ${fields.join(', ')}
       WHERE company_id = $1 AND id = $2 RETURNING *`,
      values,
    );
    if (!rows[0]) return next(new HttpError(404, 'category not found'));
    return res.json(rows[0]);
  } catch (e) { return next(e); }
});

router.delete('/:id', requireRole(['owner', 'admin']), async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM salons.service_categories WHERE company_id = $1 AND id = $2`,
      [req.auth!.company_id, req.params.id],
    );
    if (!rowCount) return next(new HttpError(404, 'category not found'));
    return res.status(204).end();
  } catch (e) { return next(e); }
});

export default router;
