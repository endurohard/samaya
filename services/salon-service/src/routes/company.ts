import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db';
import { authenticate, requireRole, HttpError } from '../middleware';

const router = Router();
router.use(authenticate);

// GET /api/salons/company — текущий профиль компании.
// Если в company_profile нет строки — создаём пустую с именем из users.companies.
router.get('/', async (req, res, next) => {
  try {
    let { rows } = await pool.query(
      `SELECT cp.company_id, cp.name, cp.address, cp.phone, cp.email, cp.website,
              cp.default_open, cp.default_close, cp.timezone,
              cp.logo_url, cp.description, cp.settings_jsonb, cp.updated_at
       FROM salons.company_profile cp
       WHERE cp.company_id = $1`,
      [req.auth!.company_id],
    );
    if (!rows[0]) {
      const ins = await pool.query(
        `INSERT INTO salons.company_profile (company_id, name)
         SELECT $1, name FROM users.companies WHERE id = $1
         ON CONFLICT (company_id) DO NOTHING
         RETURNING company_id, name, address, phone, email, website,
                   default_open, default_close, timezone,
                   logo_url, description, settings_jsonb, updated_at`,
        [req.auth!.company_id],
      );
      rows = ins.rows;
    }
    if (!rows[0]) return next(new HttpError(404, 'company not found'));
    return res.json(rows[0]);
  } catch (e) { return next(e); }
});

const putSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  address: z.string().max(500).nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  email: z.string().email().nullable().or(z.literal('')).optional(),
  website: z.string().url().nullable().or(z.literal('')).optional(),
  default_open: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  default_close: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  timezone: z.string().max(64).optional(),
  logo_url: z.string().url().nullable().or(z.literal('')).optional(),
  description: z.string().max(2000).nullable().optional(),
  settings_jsonb: z.record(z.unknown()).optional(),
});

router.put('/', requireRole(['owner', 'admin']), async (req, res, next) => {
  try {
    const input = putSchema.parse(req.body);
    const fields: string[] = [];
    const values: unknown[] = [req.auth!.company_id];
    for (const [k, v] of Object.entries(input)) {
      if (v === undefined) continue;
      values.push(v === '' ? null : v);
      fields.push(`${k} = $${values.length}`);
    }
    if (!fields.length) return res.status(400).json({ error: 'no fields to update' });
    // Upsert
    const { rows } = await pool.query(
      `INSERT INTO salons.company_profile (company_id) VALUES ($1)
       ON CONFLICT (company_id) DO UPDATE SET ${fields.join(', ')}
       RETURNING company_id, name, address, phone, email, website,
                 default_open, default_close, timezone,
                 logo_url, description, settings_jsonb, updated_at`,
      values,
    );
    return res.json(rows[0]);
  } catch (e) { return next(e); }
});

export default router;
