import { Router } from 'express';
import { z } from 'zod';
import { isoDate } from '../validators';
import { pool } from '../db';
import { authenticate, requireRole, HttpError } from '../middleware';

const router = Router();
router.use(authenticate);

// ===== List =====
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, code, name, discount_pct::float8, valid_from, valid_to,
              max_uses, used_count, is_active, created_at
       FROM bookings.promotions
       WHERE company_id = $1
       ORDER BY created_at DESC`,
      [req.auth!.company_id],
    );
    return res.json({ items: rows });
  } catch (e) { return next(e); }
});

// ===== Check (validate a code) =====
router.get('/check', async (req, res, next) => {
  try {
    const code = String(req.query.code ?? '').trim().toUpperCase();
    if (!code) return next(new HttpError(400, 'code required'));
    const today = new Date().toISOString().slice(0, 10);
    const { rows } = await pool.query(
      `SELECT id, code, name, discount_pct::float8, valid_from, valid_to, max_uses, used_count, is_active
       FROM bookings.promotions
       WHERE company_id = $1 AND code = $2`,
      [req.auth!.company_id, code],
    );
    if (!rows.length) return next(new HttpError(404, 'promo not found', 'PROMO_NOT_FOUND'));
    const p = rows[0];
    if (!p.is_active) return next(new HttpError(400, 'promo is inactive', 'PROMO_INACTIVE'));
    if (p.valid_from && p.valid_from > today) return next(new HttpError(400, 'promo not started yet', 'PROMO_NOT_STARTED'));
    if (p.valid_to && p.valid_to < today) return next(new HttpError(400, 'promo expired', 'PROMO_EXPIRED'));
    if (p.max_uses != null && p.used_count >= p.max_uses) return next(new HttpError(400, 'promo limit reached', 'PROMO_EXHAUSTED'));
    return res.json(p);
  } catch (e) { return next(e); }
});

// ===== Create =====
const createSchema = z.object({
  code: z.string().min(2).max(32).transform((s) => s.toUpperCase()),
  name: z.string().min(1).max(200),
  discount_pct: z.number().positive().max(100),
  valid_from: isoDate().nullable().optional(),
  valid_to: isoDate().nullable().optional(),
  max_uses: z.number().int().positive().nullable().optional(),
});

router.post('/', requireRole(['owner', 'admin']), async (req, res, next) => {
  try {
    const input = createSchema.parse(req.body);
    const { rows } = await pool.query(
      `INSERT INTO bookings.promotions (company_id, code, name, discount_pct, valid_from, valid_to, max_uses)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, code, name, discount_pct::float8, valid_from, valid_to, max_uses, used_count, is_active, created_at`,
      [req.auth!.company_id, input.code, input.name, input.discount_pct,
       input.valid_from ?? null, input.valid_to ?? null, input.max_uses ?? null],
    );
    return res.status(201).json(rows[0]);
  } catch (e: unknown) {
    if ((e as { code?: string }).code === '23505') return next(new HttpError(409, 'code already exists', 'PROMO_CODE_EXISTS'));
    return next(e);
  }
});

// ===== Update =====
const updateSchema = createSchema.partial().extend({ is_active: z.boolean().optional() });

router.patch('/:id', requireRole(['owner', 'admin']), async (req, res, next) => {
  try {
    const input = updateSchema.parse(req.body);
    const fields: string[] = [];
    const vals: unknown[] = [req.auth!.company_id, req.params.id];
    for (const [k, v] of Object.entries(input)) {
      vals.push(v);
      fields.push(`${k} = $${vals.length}`);
    }
    if (!fields.length) return next(new HttpError(400, 'nothing to update'));
    const { rows } = await pool.query(
      `UPDATE bookings.promotions SET ${fields.join(', ')}
       WHERE company_id = $1 AND id = $2
       RETURNING id, code, name, discount_pct::float8, valid_from, valid_to, max_uses, used_count, is_active`,
      vals,
    );
    if (!rows.length) return next(new HttpError(404, 'not found'));
    return res.json(rows[0]);
  } catch (e) { return next(e); }
});

// ===== Delete =====
router.delete('/:id', requireRole(['owner', 'admin']), async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM bookings.promotions WHERE company_id = $1 AND id = $2`,
      [req.auth!.company_id, req.params.id],
    );
    if (!rowCount) return next(new HttpError(404, 'not found'));
    return res.status(204).send();
  } catch (e) { return next(e); }
});

export default router;
