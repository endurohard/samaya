import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db';
import { authenticate, requireRole, HttpError } from '../middleware';

const router = Router();
router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, inn, phone, notes, is_active, created_at, updated_at
       FROM inventory.suppliers
       WHERE company_id = $1
       ORDER BY is_active DESC, name`,
      [req.auth!.company_id],
    );
    res.json({ items: rows });
  } catch (e) { next(e); }
});

const createSchema = z.object({
  name: z.string().min(1).max(200),
  inn: z.string().max(20).nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

router.post('/', requireRole(['owner', 'admin']), async (req, res, next) => {
  try {
    const input = createSchema.parse(req.body);
    const { rows } = await pool.query(
      `INSERT INTO inventory.suppliers (company_id, name, inn, phone, notes)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.auth!.company_id, input.name, input.inn ?? null, input.phone ?? null, input.notes ?? null],
    );
    res.status(201).json(rows[0]);
  } catch (e: unknown) {
    if ((e as { code?: string }).code === '23505') {
      return next(new HttpError(409, 'supplier name already exists', 'SUPPLIER_EXISTS'));
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
      `UPDATE inventory.suppliers SET ${fields.join(', ')}
       WHERE company_id = $1 AND id = $2 RETURNING *`,
      values,
    );
    if (!rows[0]) return next(new HttpError(404, 'supplier not found'));
    res.json(rows[0]);
  } catch (e) { next(e); }
});

export default router;
