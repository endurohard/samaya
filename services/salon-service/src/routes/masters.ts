import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db';
import { authenticate, requireRole, HttpError } from '../middleware';

const router = Router();
router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT m.id, m.company_id, m.user_id, m.display_name, m.specialization,
              m.first_name, m.last_name, m.position, m.category,
              m.phone, m.email, m.notes, m.provides_services, m.in_commission_pool,
              m.dismissed_at,
              m.avatar_url, m.sort_order, m.is_active, m.created_at, m.updated_at,
              COALESCE(
                json_agg(ms.service_id) FILTER (WHERE ms.service_id IS NOT NULL),
                '[]'::json
              ) AS service_ids
       FROM salons.masters m
       LEFT JOIN salons.master_services ms ON ms.master_id = m.id
       WHERE m.company_id = $1
       GROUP BY m.id
       ORDER BY m.sort_order, m.display_name`,
      [req.auth!.company_id],
    );
    return res.json({ items: rows });
  } catch (e) { return next(e); }
});

// GET /:id — карточка одного сотрудника (для модалки edit)
router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT m.id, m.company_id, m.user_id, m.display_name, m.specialization,
              m.first_name, m.last_name, m.position, m.category,
              m.phone, m.email, m.notes, m.provides_services, m.in_commission_pool,
              m.dismissed_at,
              m.avatar_url, m.sort_order, m.is_active, m.created_at, m.updated_at,
              COALESCE(
                json_agg(ms.service_id) FILTER (WHERE ms.service_id IS NOT NULL),
                '[]'::json
              ) AS service_ids
       FROM salons.masters m
       LEFT JOIN salons.master_services ms ON ms.master_id = m.id
       WHERE m.company_id = $1 AND m.id = $2
       GROUP BY m.id`,
      [req.auth!.company_id, req.params.id],
    );
    if (!rows[0]) return next(new HttpError(404, 'master not found'));
    return res.json(rows[0]);
  } catch (e) { return next(e); }
});

const createSchema = z.object({
  user_id: z.string().uuid().nullable().optional(),
  // Один из двух обязателен: либо display_name, либо first_name+last_name.
  display_name: z.string().min(1).max(200).optional(),
  first_name: z.string().max(100).nullable().optional(),
  last_name: z.string().max(100).nullable().optional(),
  position: z.string().max(100).nullable().optional(),
  category: z.string().max(100).nullable().optional(),
  specialization: z.string().max(200).nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  email: z.string().email().nullable().or(z.literal('')).optional(),
  notes: z.string().max(2000).nullable().optional(),
  provides_services: z.boolean().optional(),
  in_commission_pool: z.boolean().optional(),
  avatar_url: z.string().url().nullable().or(z.literal('')).optional(),
  sort_order: z.number().int().optional(),
}).refine((d) => d.display_name || d.first_name || d.last_name, {
  message: 'display_name OR first_name+last_name required',
});

function composeDisplayName(input: { display_name?: string; first_name?: string | null; last_name?: string | null }): string {
  if (input.display_name) return input.display_name;
  return [input.last_name, input.first_name].filter(Boolean).join(' ').trim() || '—';
}

router.post('/', requireRole(['owner', 'admin']), async (req, res, next) => {
  try {
    const input = createSchema.parse(req.body);
    const display_name = composeDisplayName(input);
    const { rows } = await pool.query(
      `INSERT INTO salons.masters
         (company_id, user_id, display_name,
          first_name, last_name, position, category,
          specialization, phone, email, notes, provides_services,
          avatar_url, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING *`,
      [
        req.auth!.company_id,
        input.user_id ?? null,
        display_name,
        input.first_name ?? null,
        input.last_name ?? null,
        input.position ?? null,
        input.category ?? null,
        input.specialization ?? null,
        input.phone ?? null,
        input.email === '' ? null : (input.email ?? null),
        input.notes ?? null,
        input.provides_services ?? true,
        input.avatar_url === '' ? null : (input.avatar_url ?? null),
        input.sort_order ?? 0,
      ],
    );
    return res.status(201).json(rows[0]);
  } catch (e: unknown) {
    if ((e as { code?: string }).code === '23505') {
      return next(new HttpError(409, 'master with this user already exists', 'MASTER_EXISTS'));
    }
    return next(e);
  }
});

const updateSchema = createSchema.innerType().partial().omit({ user_id: true }).extend({
  is_active: z.boolean().optional(),
  dismissed_at: z.string().datetime().nullable().optional(),
});

router.patch('/:id', requireRole(['owner', 'admin']), async (req, res, next) => {
  try {
    const input = updateSchema.parse(req.body);
    const fields: string[] = [];
    const values: unknown[] = [req.auth!.company_id, req.params.id];
    for (const [k, v] of Object.entries(input)) {
      // Нормализуем пустые строки в null для текстовых полей с email/url
      const normalized = (v === '' && (k === 'email' || k === 'avatar_url')) ? null : v;
      values.push(normalized);
      fields.push(`${k} = $${values.length}`);
    }
    // Если поменялись first_name/last_name — пересоберём display_name (если не задан явно)
    if ((input.first_name !== undefined || input.last_name !== undefined) && input.display_name === undefined) {
      const cur = await pool.query(
        `SELECT first_name, last_name FROM salons.masters WHERE company_id = $1 AND id = $2`,
        [req.auth!.company_id, req.params.id],
      );
      if (cur.rows[0]) {
        const fn = input.first_name !== undefined ? input.first_name : cur.rows[0].first_name;
        const ln = input.last_name !== undefined ? input.last_name : cur.rows[0].last_name;
        const dn = [ln, fn].filter(Boolean).join(' ').trim() || '—';
        values.push(dn);
        fields.push(`display_name = $${values.length}`);
      }
    }
    if (!fields.length) return res.status(400).json({ error: 'no fields to update' });
    const { rows } = await pool.query(
      `UPDATE salons.masters SET ${fields.join(', ')}
       WHERE company_id = $1 AND id = $2 RETURNING *`,
      values,
    );
    if (!rows[0]) return next(new HttpError(404, 'master not found'));
    return res.json(rows[0]);
  } catch (e) { return next(e); }
});

router.delete('/:id', requireRole(['owner', 'admin']), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `UPDATE salons.masters SET is_active = FALSE
       WHERE company_id = $1 AND id = $2 RETURNING id`,
      [req.auth!.company_id, req.params.id],
    );
    if (!rows[0]) return next(new HttpError(404, 'master not found'));
    return res.status(204).end();
  } catch (e) { return next(e); }
});

const assignSchema = z.object({
  service_ids: z.array(z.string().uuid()),
});

// PUT /:id/services — replace all assignments
router.put('/:id/services', requireRole(['owner', 'admin']), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { service_ids } = assignSchema.parse(req.body);
    await client.query('BEGIN');

    const m = await client.query(
      `SELECT id FROM salons.masters WHERE company_id = $1 AND id = $2`,
      [req.auth!.company_id, req.params.id],
    );
    if (!m.rows[0]) throw new HttpError(404, 'master not found');

    if (service_ids.length > 0) {
      const check = await client.query(
        `SELECT COUNT(*)::int AS c FROM salons.services
         WHERE company_id = $1 AND id = ANY($2::uuid[])`,
        [req.auth!.company_id, service_ids],
      );
      if (check.rows[0].c !== service_ids.length) {
        throw new HttpError(400, 'some service ids not found in this company');
      }
    }

    await client.query(`DELETE FROM salons.master_services WHERE master_id = $1`, [req.params.id]);
    if (service_ids.length > 0) {
      const valuesSql = service_ids.map((_, i) => `($1, $${i + 2})`).join(', ');
      await client.query(
        `INSERT INTO salons.master_services (master_id, service_id) VALUES ${valuesSql}`,
        [req.params.id, ...service_ids],
      );
    }

    await client.query('COMMIT');
    return res.json({ master_id: req.params.id, service_ids });
  } catch (e) {
    await client.query('ROLLBACK');
    return next(e);
  } finally {
    client.release();
  }
});

export default router;
