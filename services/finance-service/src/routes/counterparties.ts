import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db';
import { authenticate, requireRole, HttpError } from '../middleware';

const router = Router();
router.use(authenticate);

const KINDS = ['supplier', 'customer', 'employee', 'other'] as const;

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, inn, kind, phone, email, notes, is_active, created_at
       FROM finance.counterparties
       WHERE company_id = $1
       ORDER BY is_active DESC, name`,
      [req.auth!.company_id],
    );
    return res.json({ items: rows });
  } catch (e) { return next(e); }
});

const createSchema = z.object({
  name: z.string().min(1).max(200),
  inn: z.string().max(20).optional(),
  kind: z.enum(KINDS).default('other'),
  phone: z.string().max(50).optional(),
  email: z.string().email().max(200).optional(),
  notes: z.string().max(2000).optional(),
});

router.post('/', requireRole(['owner', 'admin']), async (req, res, next) => {
  try {
    const input = createSchema.parse(req.body);
    const { rows } = await pool.query(
      `INSERT INTO finance.counterparties
         (company_id, name, inn, kind, phone, email, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, name, inn, kind, phone, email, notes, is_active, created_at`,
      [
        req.auth!.company_id, input.name,
        input.inn ?? null, input.kind,
        input.phone ?? null, input.email ?? null, input.notes ?? null,
      ],
    );
    return res.status(201).json(rows[0]);
  } catch (e: unknown) {
    if ((e as { code?: string }).code === '23505') {
      return next(new HttpError(409, 'counterparty name already exists', 'DUP_NAME'));
    }
    return next(e);
  }
});

const patchSchema = createSchema.partial().extend({
  is_active: z.boolean().optional(),
});

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
    const { rows } = await pool.query(
      `UPDATE finance.counterparties SET ${fields.join(', ')}
       WHERE company_id = $1 AND id = $2
       RETURNING id, name, inn, kind, phone, email, notes, is_active, created_at`,
      values,
    );
    if (!rows[0]) return next(new HttpError(404, 'counterparty not found'));
    return res.json(rows[0]);
  } catch (e) { return next(e); }
});

router.delete('/:id', requireRole(['owner', 'admin']), async (req, res, next) => {
  try {
    const upd = await pool.query(
      `UPDATE finance.counterparties SET is_active = FALSE
       WHERE company_id = $1 AND id = $2 RETURNING id`,
      [req.auth!.company_id, req.params.id],
    );
    if (!upd.rows[0]) return next(new HttpError(404, 'counterparty not found'));
    return res.json({ ok: true });
  } catch (e) { return next(e); }
});

export default router;
