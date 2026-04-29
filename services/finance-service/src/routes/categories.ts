import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db';
import { authenticate, requireRole, HttpError } from '../middleware';

const router = Router();
router.use(authenticate);

const listSchema = z.object({
  kind: z.enum(['income', 'expense']).optional(),
});

router.get('/', async (req, res, next) => {
  try {
    const q = listSchema.parse(req.query);
    const params: unknown[] = [req.auth!.company_id];
    let where = `company_id = $1 AND is_active = TRUE`;
    if (q.kind) {
      params.push(q.kind);
      where += ` AND kind = $${params.length}`;
    }
    const { rows } = await pool.query(
      `SELECT id, name, kind, sort_order
       FROM finance.cashflow_categories
       WHERE ${where}
       ORDER BY kind, sort_order, name`,
      params,
    );
    return res.json({ items: rows });
  } catch (e) { return next(e); }
});

const createSchema = z.object({
  name: z.string().min(1).max(120),
  kind: z.enum(['income', 'expense']),
  sort_order: z.number().int().min(0).max(9999).default(100),
});

router.post('/', requireRole(['owner', 'admin']), async (req, res, next) => {
  try {
    const input = createSchema.parse(req.body);
    const { rows } = await pool.query(
      `INSERT INTO finance.cashflow_categories (company_id, name, kind, sort_order)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, kind, sort_order`,
      [req.auth!.company_id, input.name, input.kind, input.sort_order],
    );
    return res.status(201).json(rows[0]);
  } catch (e: unknown) {
    if ((e as { code?: string }).code === '23505') {
      return next(new HttpError(409, 'category already exists', 'DUP_NAME'));
    }
    return next(e);
  }
});

router.delete('/:id', requireRole(['owner', 'admin']), async (req, res, next) => {
  try {
    // Soft-delete (operations могут ссылаться).
    const upd = await pool.query(
      `UPDATE finance.cashflow_categories SET is_active = FALSE
       WHERE company_id = $1 AND id = $2 RETURNING id`,
      [req.auth!.company_id, req.params.id],
    );
    if (!upd.rows[0]) return next(new HttpError(404, 'category not found'));
    return res.json({ ok: true });
  } catch (e) { return next(e); }
});

export default router;
