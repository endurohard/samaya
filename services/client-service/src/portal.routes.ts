import { Router } from 'express';
import { z } from 'zod';
import { pool } from './db';

const router = Router();

const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15 MB unencoded

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'] as const;

const uploadSchema = z.object({
  file_name: z.string().min(1).max(255),
  mime_type: z.enum(ALLOWED_MIME),
  // ~15 MB бинарных данных ≈ 20 MB base64; отсекаем до декодирования
  data_base64: z.string().min(1).max(Math.ceil(MAX_FILE_BYTES * 4 / 3) + 4),
});

// Magic bytes: содержимое файла должно соответствовать заявленному MIME
function matchesMime(buf: Buffer, mime: string): boolean {
  if (buf.length < 12) return false;
  switch (mime) {
    case 'image/jpeg':
      return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    case 'image/png':
      return buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    case 'image/webp':
      return buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP';
    case 'image/gif':
      return buf.toString('latin1', 0, 4) === 'GIF8';
    case 'application/pdf':
      return buf.toString('latin1', 0, 4) === '%PDF';
    default:
      return false;
  }
}

// Имя файла для Content-Disposition: убираем кавычки, управляющие символы и пути
function safeFileName(name: string): string {
  let out = '';
  for (const ch of name) {
    const code = ch.codePointAt(0) ?? 0;
    out += code < 0x20 || ch === '"' || ch === '/' || ch === '\\' ? '_' : ch;
  }
  return out.slice(0, 255).trim() || 'file';
}

// GET /api/clients/portal/:token  — client dashboard: info + visits + bonus + files
router.get('/:token', async (req, res, next) => {
  try {
    const r = await pool.query(
      `SELECT id, company_id, full_name, phone::text AS phone,
              bonus_balance::float8 AS bonus_balance, avatar_color
       FROM clients.clients WHERE upload_token = $1 AND is_deleted = FALSE AND is_blocked = FALSE`,
      [req.params.token],
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'not_found' });
    const { id, company_id, full_name, phone, bonus_balance, avatar_color } = r.rows[0];

    const [filesRes, bookingsRes, statsRes] = await Promise.all([
      pool.query(
        `SELECT id, file_name, mime_type, file_size, uploaded_by, created_at
         FROM clients.client_files WHERE client_id = $1 ORDER BY created_at DESC`,
        [id],
      ),
      // Last 20 completed bookings
      pool.query(
        `SELECT b.id, b.starts_at, b.completed_at, b.total_price::float8 AS total_price,
                b.discount_amount::float8 AS discount_amount,
                b.bonus_spend::float8 AS bonus_spend,
                b.payment_method, b.status,
                COALESCE(m.display_name, b.master_id::text) AS master_name,
                COALESCE(
                  (SELECT json_agg(service_name ORDER BY sort_order, service_name)
                   FROM bookings.booking_services WHERE booking_id = b.id),
                  '[]'::json
                ) AS services,
                (SELECT rating FROM bookings.reviews WHERE booking_id = b.id) AS my_rating
         FROM bookings.bookings b
         LEFT JOIN salons.masters m ON m.id = b.master_id
         WHERE b.company_id = $1 AND b.client_id = $2
         ORDER BY b.starts_at DESC LIMIT 20`,
        [company_id, id],
      ),
      // Lifetime stats
      pool.query(
        `SELECT COUNT(*) FILTER (WHERE status = 'completed')::int         AS total_visits,
                COALESCE(SUM(total_price - discount_amount)
                  FILTER (WHERE status = 'completed'), 0)::float8          AS total_spent,
                MAX(completed_at)                                           AS last_visit
         FROM bookings.bookings WHERE company_id = $1 AND client_id = $2`,
        [company_id, id],
      ),
    ]);

    return res.json({
      client: { id, full_name, phone, bonus_balance, avatar_color },
      stats: statsRes.rows[0],
      bookings: bookingsRes.rows,
      files: filesRes.rows,
    });
  } catch (e) { return next(e); }
});

// POST /api/clients/portal/:token/files  — client uploads a file (public)
router.post('/:token/files', async (req, res, next) => {
  try {
    const c = await pool.query(
      `SELECT id, company_id FROM clients.clients WHERE upload_token = $1 AND is_deleted = FALSE AND is_blocked = FALSE`,
      [req.params.token],
    );
    if (!c.rows[0]) return res.status(404).json({ error: 'not_found' });
    const { id: clientId, company_id: companyId } = c.rows[0];

    const input = uploadSchema.parse(req.body);
    const buf = Buffer.from(input.data_base64, 'base64');
    if (buf.length > MAX_FILE_BYTES) {
      return res.status(413).json({ error: 'file_too_large', max_mb: 15 });
    }
    if (!matchesMime(buf, input.mime_type)) {
      return res.status(400).json({ error: 'mime_mismatch' });
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
      `SELECT id FROM clients.clients WHERE upload_token = $1 AND is_deleted = FALSE AND is_blocked = FALSE`,
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
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Content-Disposition', `inline; filename="${safeFileName(f.rows[0].file_name)}"`);
    return res.send(f.rows[0].file_data);
  } catch (e) { return next(e); }
});

// DELETE /api/clients/portal/:token/files/:fileId  — client deletes own file
router.delete('/:token/files/:fileId', async (req, res, next) => {
  try {
    const c = await pool.query(
      `SELECT id FROM clients.clients WHERE upload_token = $1 AND is_deleted = FALSE AND is_blocked = FALSE`,
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
