import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db';
import { authenticate, requireRole, HttpError } from '../middleware';

const router = Router();
router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         p.id, p.name, p.unit, p.category, p.min_stock::float8 AS min_stock,
         p.is_consumable, p.tracking_mode, p.is_active, p.created_at, p.updated_at,
         COALESCE(s.total_qty, 0)::float8 AS stock_qty,
         COALESCE(s.avg_cost, 0)::float8 AS avg_cost
       FROM inventory.products p
       LEFT JOIN LATERAL (
         SELECT
           SUM(qty_remaining) AS total_qty,
           CASE WHEN SUM(qty_remaining) > 0
             THEN SUM(qty_remaining * unit_cost) / SUM(qty_remaining)
             ELSE 0 END AS avg_cost
         FROM inventory.stock_lots
         WHERE company_id = $1 AND product_id = p.id AND qty_remaining > 0
       ) s ON TRUE
       WHERE p.company_id = $1
       ORDER BY p.is_active DESC, p.name`,
      [req.auth!.company_id],
    );
    res.json({ items: rows });
  } catch (e) { next(e); }
});

const TRACKING_MODES = ['auto', 'manual', 'periodic', 'expense_only'] as const;

const createSchema = z.object({
  name: z.string().min(1).max(200),
  unit: z.string().min(1).max(20).default('шт'),
  category: z.string().max(100).nullable().optional(),
  min_stock: z.number().nonnegative().optional(),
  is_consumable: z.boolean().optional(),
  tracking_mode: z.enum(TRACKING_MODES).default('auto'),
});

router.post('/', requireRole(['owner', 'admin']), async (req, res, next) => {
  try {
    const input = createSchema.parse(req.body);
    const { rows } = await pool.query(
      `INSERT INTO inventory.products
         (company_id, name, unit, category, min_stock, is_consumable, tracking_mode)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        req.auth!.company_id,
        input.name, input.unit,
        input.category ?? null,
        input.min_stock ?? 0,
        input.is_consumable ?? true,
        input.tracking_mode,
      ],
    );
    res.status(201).json(rows[0]);
  } catch (e: unknown) {
    if ((e as { code?: string }).code === '23505') {
      return next(new HttpError(409, 'product name already exists', 'PRODUCT_EXISTS'));
    }
    next(e);
  }
});

const updateSchema = createSchema.partial().extend({ is_active: z.boolean().optional() });
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
      `UPDATE inventory.products SET ${fields.join(', ')}
       WHERE company_id = $1 AND id = $2 RETURNING *`,
      values,
    );
    if (!rows[0]) return next(new HttpError(404, 'product not found'));
    res.json(rows[0]);
  } catch (e) { next(e); }
});

router.delete('/:id', requireRole(['owner', 'admin']), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `UPDATE inventory.products SET is_active = FALSE
       WHERE company_id = $1 AND id = $2 RETURNING id`,
      [req.auth!.company_id, req.params.id],
    );
    if (!rows[0]) return next(new HttpError(404, 'product not found'));
    res.status(204).end();
  } catch (e) { next(e); }
});

export default router;
