import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from './middleware';
import {
  listClients, segmentCounts, createClient, updateClient,
  softDelete, restore, getClient, type Segment,
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
