import { Router } from 'express';
import { z } from 'zod';
import { pool } from './db';

const router = Router();

const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15 MB unencoded

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'] as const;

const uploadSchema = z.object({
  file_name: z.string().min(1).max(255),
  mime_type: z.enum(ALLOWED_MIME),
  data_base64: z.string().min(1),
});

// GET /api/clients/portal/:token  — client info + file list (public)
router.get('/:token', async (req, res, next) => {
  try {
    const r = await pool.query(
      `SELECT id, full_name, phone::text AS phone
       FROM clients.clients WHERE upload_token = $1 AND is_deleted = FALSE`,
      [req.params.token],
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'not_found' });
    const { id, full_name } = r.rows[0];
    const files = await pool.query(
      `SELECT id, file_name, mime_type, file_size, uploaded_by, created_at
       FROM clients.client_files WHERE client_id = $1 ORDER BY created_at DESC`,
      [id],
    );
    return res.json({ client: { id, full_name }, files: files.rows });
  } catch (e) { return next(e); }
});

// POST /api/clients/portal/:token/files  — client uploads a file (public)
router.post('/:token/files', async (req, res, next) => {
  try {
    const c = await pool.query(
      `SELECT id, company_id FROM clients.clients WHERE upload_token = $1 AND is_deleted = FALSE`,
      [req.params.token],
    );
    if (!c.rows[0]) return res.status(404).json({ error: 'not_found' });
    const { id: clientId, company_id: companyId } = c.rows[0];

    const input = uploadSchema.parse(req.body);
    const buf = Buffer.from(input.data_base64, 'base64');
    if (buf.length > MAX_FILE_BYTES) {
      return res.status(413).json({ error: 'file_too_large', max_mb: 15 });
    }

    const ins = await pool.query(
      `INSERT INTO clients.client_files
         (company_id, client_id, file_name, mime_type, file_size, file_data, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,'client')
       RETURNING id, file_name, mime_type, file_size, created_at`,
      [companyId, clientId, input.file_name, input.mime_type, buf.length, buf],
    );
    return res.status(201).json(ins.rows[0]);
  } catch (e) { return next(e); }
});

// GET /api/clients/portal/:token/files/:fileId  — download (public, for client)
router.get('/:token/files/:fileId', async (req, res, next) => {
  try {
    const c = await pool.query(
      `SELECT id FROM clients.clients WHERE upload_token = $1 AND is_deleted = FALSE`,
      [req.params.token],
    );
    if (!c.rows[0]) return res.status(404).json({ error: 'not_found' });
    const f = await pool.query(
      `SELECT file_name, mime_type, file_data
       FROM clients.client_files WHERE id = $1 AND client_id = $2`,
      [req.params.fileId, c.rows[0].id],
    );
    if (!f.rows[0]) return res.status(404).json({ error: 'not_found' });
    res.set('Content-Type', f.rows[0].mime_type);
    res.set('Content-Disposition', `inline; filename="${f.rows[0].file_name}"`);
    return res.send(f.rows[0].file_data);
  } catch (e) { return next(e); }
});

// DELETE /api/clients/portal/:token/files/:fileId  — client deletes own file
router.delete('/:token/files/:fileId', async (req, res, next) => {
  try {
    const c = await pool.query(
      `SELECT id FROM clients.clients WHERE upload_token = $1 AND is_deleted = FALSE`,
      [req.params.token],
    );
    if (!c.rows[0]) return res.status(404).json({ error: 'not_found' });
    await pool.query(
      `DELETE FROM clients.client_files WHERE id = $1 AND client_id = $2`,
      [req.params.fileId, c.rows[0].id],
    );
    return res.json({ ok: true });
  } catch (e) { return next(e); }
});

export default router;
