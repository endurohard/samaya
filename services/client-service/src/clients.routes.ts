import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from './middleware';
import {
  listClients, segmentCounts, createClient, updateClient,
  softDelete, restore, getClient, normalizePhone, pickAvatarColor, type Segment,
} from './clients.service';
import { pool } from './db';

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'] as const;
const fileUploadSchema = z.object({
  file_name: z.string().min(1).max(255),
  mime_type: z.enum(ALLOWED_MIME),
  data_base64: z.string().min(1),
});

const router = Router();

const SEGMENTS: Segment[] = ['all', 'regular', 'sleeping', 'missing', 'never', 'new', 'blocked', 'deleted'];

router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const segment = (req.query.segment as Segment) || 'all';
    if (!SEGMENTS.includes(segment)) {
      return res.status(400).json({ error: 'invalid segment' });
    }
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10) || 50, 200);
    const offset = parseInt(String(req.query.offset ?? '0'), 10) || 0;

    const data = await listClients({
      companyId: req.auth!.company_id, segment, search, limit, offset,
    });
    return res.json(data);
  } catch (err) { return next(err); }
});

router.get('/segments', async (req, res, next) => {
  try {
    const counts = await segmentCounts(req.auth!.company_id);
    return res.json(counts);
  } catch (err) { return next(err); }
});

// ── CSV export (must be before /:id) ──
router.get('/export.csv', async (req, res, next) => {
  try {
    const companyId = req.auth!.company_id;
    const { rows } = await pool.query(
      `SELECT c.phone, c.full_name,
              c.gender, c.birthday, c.email, c.comment,
              c.bonus_balance::float8 AS bonus_balance,
              c.source, c.created_at,
              COALESCE(st.total_visits, 0) AS total_visits,
              COALESCE(st.total_paid, 0)::float8 AS total_spent,
              st.last_visit_at,
              CASE WHEN c.is_blocked THEN 'blocked'
                   WHEN c.is_deleted THEN 'deleted'
                   ELSE 'active' END AS status
       FROM clients.clients c
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS total_visits,
                SUM(b.total_price - b.discount_amount) AS total_paid,
                MAX(b.completed_at) AS last_visit_at
         FROM bookings.bookings b
         WHERE b.client_id = c.id AND b.status = 'completed'
       ) st ON TRUE
       WHERE c.company_id = $1
       ORDER BY c.created_at DESC`,
      [companyId],
    );

    const escape = (v: unknown) => {
      if (v == null) return '';
      const s = String(v).replace(/"/g, '""');
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s;
    };
    const cols = [
      'Телефон', 'Имя', 'Пол', 'Дата рождения', 'Email', 'Комментарий',
      'Бонусы', 'Источник', 'Создан', 'Визиты', 'Выручка', 'Последний визит', 'Статус',
    ];
    const lines = [cols.join(',')];
    for (const r of rows) {
      lines.push([
        r.phone, r.full_name, r.gender, r.birthday, r.email, r.comment,
        r.bonus_balance, r.source,
        r.created_at ? new Date(r.created_at).toISOString().slice(0, 10) : '',
        r.total_visits, r.total_spent,
        r.last_visit_at ? new Date(r.last_visit_at).toISOString().slice(0, 10) : '',
        r.status,
      ].map(escape).join(','));
    }

    const now = new Date().toISOString().slice(0, 10);
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="clients-${now}.csv"`);
    return res.send('﻿' + lines.join('\r\n')); // BOM for Excel
  } catch (e) { return next(e); }
});

// ── CSV import (must be before /:id) ──
const importRowSchema = z.object({
  phone: z.string().min(5).max(50),
  full_name: z.string().min(1).max(200),
  email: z.string().email().optional().nullable().or(z.literal('').transform(() => null)),
  gender: z.enum(['male', 'female']).optional().nullable().or(z.literal('').transform(() => null)),
  birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable().or(z.literal('').transform(() => null)),
  comment: z.string().max(1000).optional().nullable().or(z.literal('').transform(() => null)),
});
const importSchema = z.object({
  rows: z.array(importRowSchema).min(1).max(5000),
});

router.post('/import', requireRole('admin', 'owner'), async (req, res, next) => {
  try {
    const { rows } = importSchema.parse(req.body);
    const companyId = req.auth!.company_id;
    let created = 0; let updated = 0; const errors: { row: number; error: string }[] = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      try {
        const phone = normalizePhone(r.phone);
        const result = await pool.query(
          `INSERT INTO clients.clients
             (company_id, phone, full_name, email, gender, birthday, comment,
              avatar_color, source)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'import')
           ON CONFLICT (company_id, phone) DO UPDATE SET
             full_name   = COALESCE(NULLIF(EXCLUDED.full_name,''), clients.clients.full_name),
             email       = COALESCE(NULLIF(EXCLUDED.email::text,''), clients.clients.email::text),
             gender      = COALESCE(EXCLUDED.gender, clients.clients.gender),
             birthday    = COALESCE(EXCLUDED.birthday, clients.clients.birthday),
             comment     = COALESCE(NULLIF(EXCLUDED.comment,''), clients.clients.comment),
             updated_at  = NOW()
           RETURNING (xmax = 0) AS inserted`,
          [
            companyId, phone, r.full_name,
            r.email ?? null, r.gender ?? null, r.birthday ?? null, r.comment ?? null,
            pickAvatarColor(phone),
          ],
        );
        if (result.rows[0]?.inserted) created++; else updated++;
      } catch (e) {
        errors.push({ row: i + 1, error: (e as Error).message.slice(0, 100) });
      }
    }
    return res.json({ created, updated, errors, total: rows.length });
  } catch (e) { return next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const client = await getClient(req.auth!.company_id, req.params.id);
    return res.json(client);
  } catch (err) { return next(err); }
});

const createSchema = z.object({
  phone: z.string().min(5),
  full_name: z.string().min(1),
  birthday: z.string().optional().nullable(),
  gender: z.enum(['male', 'female']).optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal('').transform(() => null)),
  comment: z.string().optional().nullable(),
  source: z.enum(['admin', 'public_widget', 'import', 'master']).optional(),
});

router.post('/', requireRole('admin', 'master'), async (req, res, next) => {
  try {
    const input = createSchema.parse(req.body);
    const id = await createClient({ company_id: req.auth!.company_id, ...input });
    return res.status(201).json({ id });
  } catch (err) { return next(err); }
});

const updateSchema = createSchema.partial().extend({
  is_blocked: z.boolean().optional(),
  bonus_balance: z.number().optional(),
});

router.put('/:id', requireRole('admin', 'master'), async (req, res, next) => {
  try {
    const patch = updateSchema.parse(req.body);
    await updateClient(req.auth!.company_id, req.params.id, patch);
    return res.json({ ok: true });
  } catch (err) { return next(err); }
});

router.delete('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    await softDelete(req.auth!.company_id, req.params.id);
    return res.json({ ok: true });
  } catch (err) { return next(err); }
});

router.post('/:id/restore', requireRole('admin'), async (req, res, next) => {
  try {
    await restore(req.auth!.company_id, req.params.id);
    return res.json({ ok: true });
  } catch (err) { return next(err); }
});

// ── File (analyzes) endpoints ──

// GET /:id/upload-link  — returns the client's upload token and portal URL
router.get('/:id/upload-link', async (req, res, next) => {
  try {
    const r = await pool.query(
      `SELECT upload_token FROM clients.clients WHERE company_id = $1 AND id = $2 AND is_deleted = FALSE`,
      [req.auth!.company_id, req.params.id],
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'not_found' });
    return res.json({ upload_token: r.rows[0].upload_token });
  } catch (e) { return next(e); }
});

// GET /:id/files  — list files (metadata only, no binary data)
router.get('/:id/files', async (req, res, next) => {
  try {
    const r = await pool.query(
      `SELECT id, file_name, mime_type, file_size, uploaded_by, created_at
       FROM clients.client_files
       WHERE client_id = $1 AND company_id = $2
       ORDER BY created_at DESC`,
      [req.params.id, req.auth!.company_id],
    );
    return res.json({ items: r.rows });
  } catch (e) { return next(e); }
});

// POST /:id/files  — admin uploads a file on behalf of client
router.post('/:id/files', requireRole('admin', 'master'), async (req, res, next) => {
  try {
    const input = fileUploadSchema.parse(req.body);
    const buf = Buffer.from(input.data_base64, 'base64');
    if (buf.length > MAX_FILE_BYTES) {
      return res.status(413).json({ error: 'file_too_large', max_mb: 15 });
    }
    const userRow = await pool.query(
      `SELECT full_name FROM users.users WHERE id = $1`,
      [req.auth!.sub],
    );
    const uploaderName = userRow.rows[0]?.full_name || req.auth!.role;
    const ins = await pool.query(
      `INSERT INTO clients.client_files
         (company_id, client_id, file_name, mime_type, file_size, file_data, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, file_name, mime_type, file_size, created_at`,
      [req.auth!.company_id, req.params.id, input.file_name, input.mime_type,
       buf.length, buf, uploaderName],
    );
    return res.status(201).json(ins.rows[0]);
  } catch (e) { return next(e); }
});

// GET /:id/files/:fileId  — download file
router.get('/:id/files/:fileId', async (req, res, next) => {
  try {
    const r = await pool.query(
      `SELECT file_name, mime_type, file_data
       FROM clients.client_files WHERE id = $1 AND client_id = $2 AND company_id = $3`,
      [req.params.fileId, req.params.id, req.auth!.company_id],
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'not_found' });
    res.set('Content-Type', r.rows[0].mime_type);
    res.set('Content-Disposition', `inline; filename="${r.rows[0].file_name}"`);
    return res.send(r.rows[0].file_data);
  } catch (e) { return next(e); }
});

// DELETE /:id/files/:fileId  — delete file
router.delete('/:id/files/:fileId', requireRole('admin', 'master'), async (req, res, next) => {
  try {
    await pool.query(
      `DELETE FROM clients.client_files WHERE id = $1 AND client_id = $2 AND company_id = $3`,
      [req.params.fileId, req.params.id, req.auth!.company_id],
    );
    return res.json({ ok: true });
  } catch (e) { return next(e); }
});

export default router;
