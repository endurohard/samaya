import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db';
import { authenticate, requireRole, HttpError } from '../middleware';

const router = Router();
router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.id, s.company_id, s.category_id, s.name, s.price, s.duration_minutes,
              s.color, s.tech_card_id, s.is_active, s.created_at, s.updated_at,
              c.name AS category_name
       FROM salons.services s
       LEFT JOIN salons.service_categories c ON c.id = s.category_id
       WHERE s.company_id = $1
       ORDER BY c.sort_order NULLS LAST, c.name NULLS LAST, s.name`,
      [req.auth!.company_id],
    );
    return res.json({ items: rows });
  } catch (e) { return next(e); }
});

const createSchema = z.object({
  name: z.string().min(1).max(200),
  category_id: z.string().uuid().nullable().optional(),
  price: z.number().nonnegative(),
  duration_minutes: z.number().int().positive(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  is_active: z.boolean().optional(),
});

router.post('/', requireRole(['owner', 'admin']), async (req, res, next) => {
  try {
    const input = createSchema.parse(req.body);
    const { rows } = await pool.query(
      `INSERT INTO salons.services
         (company_id, category_id, name, price, duration_minutes, color, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        req.auth!.company_id,
        input.category_id ?? null,
        input.name,
        input.price,
        input.duration_minutes,
        input.color ?? null,
        input.is_active ?? true,
      ],
    );
    return res.status(201).json(rows[0]);
  } catch (e: unknown) {
    if ((e as { code?: string }).code === '23503') {
      return next(new HttpError(400, 'invalid category_id', 'INVALID_CATEGORY'));
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
    for (const [k, v] of Object.entries(input)) {
      values.push(v);
      fields.push(`${k} = $${values.length}`);
    }
    if (!fields.length) return res.status(400).json({ error: 'no fields to update' });
    const { rows } = await pool.query(
      `UPDATE salons.services SET ${fields.join(', ')}
       WHERE company_id = $1 AND id = $2 RETURNING *`,
      values,
    );
    if (!rows[0]) return next(new HttpError(404, 'service not found'));
    return res.json(rows[0]);
  } catch (e) { return next(e); }
});

router.delete('/:id', requireRole(['owner', 'admin']), async (req, res, next) => {
  try {
    // Soft-delete: бронирования сохраняют ссылку на услугу и её историческую цену
    const { rows } = await pool.query(
      `UPDATE salons.services SET is_active = FALSE
       WHERE company_id = $1 AND id = $2 RETURNING id`,
      [req.auth!.company_id, req.params.id],
    );
    if (!rows[0]) return next(new HttpError(404, 'service not found'));
    return res.status(204).end();
  } catch (e) { return next(e); }
});

export default router;
