import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db';
import { authenticate, requireRole, HttpError } from '../middleware';

const router = Router();
router.use(authenticate);

const ACCOUNT_TYPES = ['cash', 'bank', 'personal', 'other'] as const;

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, type, initial_balance::float8 AS initial_balance,
              current_balance::float8 AS current_balance,
              responsible_user_id, is_active, created_at, updated_at
       FROM finance.accounts
       WHERE company_id = $1
       ORDER BY is_active DESC, name`,
      [req.auth!.company_id],
    );
    return res.json({ items: rows });
  } catch (e) { return next(e); }
});

const createSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.enum(ACCOUNT_TYPES).default('cash'),
  initial_balance: z.number().finite().default(0),
  responsible_user_id: z.string().uuid().optional(),
});

router.post('/', requireRole(['owner', 'admin']), async (req, res, next) => {
  try {
    const input = createSchema.parse(req.body);
    const { rows } = await pool.query(
      `INSERT INTO finance.accounts
         (company_id, name, type, initial_balance, current_balance, responsible_user_id)
       VALUES ($1, $2, $3, $4, $4, $5)
       RETURNING id, name, type, initial_balance::float8 AS initial_balance,
                 current_balance::float8 AS current_balance,
                 responsible_user_id, is_active, created_at, updated_at`,
      [
        req.auth!.company_id, input.name, input.type,
        input.initial_balance, input.responsible_user_id ?? null,
      ],
    );
    return res.status(201).json(rows[0]);
  } catch (e: unknown) {
    if ((e as { code?: string }).code === '23505') {
      return next(new HttpError(409, 'account name already exists', 'DUP_NAME'));
    }
    return next(e);
  }
});

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  type: z.enum(ACCOUNT_TYPES).optional(),
  responsible_user_id: z.string().uuid().nullable().optional(),
  is_active: z.boolean().optional(),
});

router.patch('/:id', requireRole(['owner', 'admin']), async (req, res, next) => {
  try {
    const input = patchSchema.parse(req.body);
    const fields: string[] = [];
    const values: unknown[] = [req.auth!.company_id, req.params.id];
    if (input.name !== undefined) {
      values.push(input.name);
      fields.push(`name = $${values.length}`);
    }
    if (input.type !== undefined) {
      values.push(input.type);
      fields.push(`type = $${values.length}`);
    }
    if (input.responsible_user_id !== undefined) {
      values.push(input.responsible_user_id);
      fields.push(`responsible_user_id = $${values.length}`);
    }
    if (input.is_active !== undefined) {
      values.push(input.is_active);
      fields.push(`is_active = $${values.length}`);
    }
    if (!fields.length) return res.status(400).json({ error: 'no fields to update' });
    const { rows } = await pool.query(
      `UPDATE finance.accounts SET ${fields.join(', ')}
       WHERE company_id = $1 AND id = $2
       RETURNING id, name, type, initial_balance::float8 AS initial_balance,
                 current_balance::float8 AS current_balance,
                 responsible_user_id, is_active, created_at, updated_at`,
      values,
    );
    if (!rows[0]) return next(new HttpError(404, 'account not found'));
    return res.json(rows[0]);
  } catch (e) { return next(e); }
});

router.delete('/:id', requireRole(['owner']), async (req, res, next) => {
  try {
    // Hard delete только если нет операций; иначе — soft через is_active = FALSE.
    const used = await pool.query(
      `SELECT 1 FROM finance.operations
       WHERE account_id = $1 AND company_id = $2 LIMIT 1`,
      [req.params.id, req.auth!.company_id],
    );
    if (used.rows.length) {
      const upd = await pool.query(
        `UPDATE finance.accounts SET is_active = FALSE
         WHERE company_id = $1 AND id = $2 RETURNING id`,
        [req.auth!.company_id, req.params.id],
      );
      if (!upd.rows[0]) return next(new HttpError(404, 'account not found'));
      return res.json({ ok: true, soft: true });
    }
    const del = await pool.query(
      `DELETE FROM finance.accounts WHERE company_id = $1 AND id = $2 RETURNING id`,
      [req.auth!.company_id, req.params.id],
    );
    if (!del.rows[0]) return next(new HttpError(404, 'account not found'));
    return res.json({ ok: true, soft: false });
  } catch (e) { return next(e); }
});

export default router;
