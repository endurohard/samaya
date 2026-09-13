import { Router } from 'express';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { z } from 'zod';
import { config } from '../config';
import { pool } from '../db';
import { eventsStatus } from '../events';
import { HttpError, requirePermission } from '../middleware';
import { fetchRecording, VatsError } from '../vats';

const router = Router();

const listQuery = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  direction: z.enum(['inbound', 'outbound']).optional(),
  status: z.enum(['answered', 'missed', 'cancelled']).optional(),
  master_id: z.string().uuid().optional(),
  extension: z.string().max(20).optional(),
  number: z.string().max(32).optional(),
  client_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// Журнал. Имя сотрудника и клиента берём из наших справочников, а не из ВАТС:
// в карточке мастера фамилия актуальнее, а клиент мог переименоваться после
// звонка.
router.get('/calls', requirePermission('telephony.view'), async (req, res, next) => {
  try {
    const q = listQuery.parse(req.query);
    const params: unknown[] = [req.auth!.company_id];
    let where = 'WHERE c.company_id = $1';
    const add = (sql: string, value: unknown) => { params.push(value); where += ` AND ${sql.replace('$?', `$${params.length}`)}`; };

    if (q.from) add('c.started_at >= $?::timestamptz', q.from);
    if (q.to) add('c.started_at <= $?::timestamptz', q.to);
    if (q.direction) add('c.direction = $?', q.direction);
    if (q.status) add('c.status = $?', q.status);
    if (q.master_id) add('c.master_id = $?', q.master_id);
    if (q.extension) add('c.extension = $?', q.extension);
    if (q.client_id) add('c.client_id = $?', q.client_id);
    if (q.number) add('c.client_digits = $?', q.number.replace(/\D/g, '').slice(-10));

    params.push(q.limit, q.offset);
    const { rows } = await pool.query(
      `SELECT c.id, c.started_at, c.direction, c.client_number, c.client_name_vats,
              c.line, c.extension, c.master_id, c.duration_sec, c.status, c.has_recording,
              c.client_id, c.handled_by,
              m.display_name AS master_name,
              cl.full_name AS client_name
         FROM telephony.calls c
         LEFT JOIN salons.masters m ON m.id = c.master_id
         LEFT JOIN clients.clients cl ON cl.id = c.client_id
         ${where}
         ORDER BY c.started_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    const totals = await pool.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE c.status = 'answered')::int AS answered,
              COUNT(*) FILTER (WHERE c.status = 'missed')::int AS missed
         FROM telephony.calls c ${where}`,
      params.slice(0, params.length - 2),
    );

    return res.json({ items: rows, totals: totals.rows[0] });
  } catch (e) { return next(e); }
});

// Состояние синхронизации — чтобы в интерфейсе было видно, живая ли связь с
// ВАТС, а не гадать, почему журнал не пополняется.
router.get('/status', requirePermission('telephony.view'), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT synced_until, last_ok_at, last_error, last_error_at, calls_total
         FROM telephony.sync_state WHERE company_id = $1`,
      [req.auth!.company_id],
    );
    return res.json({
      ...(rows[0] ?? { synced_until: null, last_ok_at: null, last_error: null, calls_total: 0 }),
      events: eventsStatus(),
    });
  } catch (e) { return next(e); }
});

router.get('/calls/:id', requirePermission('telephony.view'), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.*, m.display_name AS master_name, cl.full_name AS client_name
         FROM telephony.calls c
         LEFT JOIN salons.masters m ON m.id = c.master_id
         LEFT JOIN clients.clients cl ON cl.id = c.client_id
        WHERE c.company_id = $1 AND c.id = $2`,
      [req.auth!.company_id, req.params.id],
    );
    if (!rows[0]) throw new HttpError(404, 'NOT_FOUND', 'call not found');
    return res.json(rows[0]);
  } catch (e) { return next(e); }
});

const cachePath = (callId: string) => path.join(config.RECORDINGS_DIR, `${callId}.mp3`);

/** Файл в кэше, при необходимости — скачанный из ВАТС. */
async function ensureCached(callId: string, companyId: string): Promise<string> {
  const file = cachePath(callId);
  try {
    const st = await fsp.stat(file);
    if (st.size > 0) return file;
  } catch { /* нет в кэше — качаем */ }

  const buf = await fetchRecording(callId);
  await fsp.mkdir(config.RECORDINGS_DIR, { recursive: true });
  // Пишем во временный файл и переименовываем: если сервис упадёт на середине
  // загрузки, в кэше не останется обрезанной записи, которую потом никто не
  // перекачает — она выглядела бы как целая.
  const tmp = `${file}.${process.pid}.part`;
  await fsp.writeFile(tmp, buf);
  await fsp.rename(tmp, file);
  await pool.query(
    `INSERT INTO telephony.recording_cache (call_id, company_id, bytes)
     VALUES ($1, $2, $3)
     ON CONFLICT (call_id) DO UPDATE SET bytes = EXCLUDED.bytes, cached_at = NOW()`,
    [callId, companyId, buf.length],
  );
  return file;
}

// Прослушивание. Отдаём из кэша с поддержкой Range: ВАТС перекодирует mp3 на
// лету и отдаёт chunked, без Content-Length, — на таком ответе браузер не даёт
// перематывать запись.
router.get('/calls/:id/recording', requirePermission('telephony.listen'), async (req, res, next) => {
  try {
    const companyId = req.auth!.company_id;
    const { rows } = await pool.query(
      'SELECT has_recording FROM telephony.calls WHERE company_id = $1 AND id = $2',
      [companyId, req.params.id],
    );
    if (!rows[0]) throw new HttpError(404, 'NOT_FOUND', 'call not found');
    if (!rows[0].has_recording) throw new HttpError(404, 'NO_RECORDING', 'у звонка нет записи');

    let file: string;
    try {
      file = await ensureCached(req.params.id, companyId);
    } catch (e) {
      if (e instanceof VatsError) throw new HttpError(502, 'VATS_UNAVAILABLE', 'ВАТС не отдала запись');
      throw e;
    }

    const size = (await fsp.stat(file)).size;
    // Прослушивание оставляет след: запись разговора с пациентом — врачебная
    // тайна, и доступ к ней должен быть объясним постфактум.
    void pool.query(
      `INSERT INTO telephony.listen_log (company_id, call_id, user_id, user_role) VALUES ($1, $2, $3, $4)`,
      [companyId, req.params.id, req.auth!.sub, req.auth!.role],
    ).catch(() => { /* журнал не должен мешать прослушиванию */ });
    void pool.query('UPDATE telephony.recording_cache SET last_played_at = NOW() WHERE call_id = $1', [req.params.id])
      .catch(() => { /* необязательная метрика */ });

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=3600');

    const range = req.headers.range;
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (m) {
        const start = m[1] ? Number(m[1]) : 0;
        const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
        if (start >= size || start > end) {
          res.status(416).setHeader('Content-Range', `bytes */${size}`);
          return res.end();
        }
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
        res.setHeader('Content-Length', String(end - start + 1));
        return fs.createReadStream(file, { start, end }).pipe(res);
      }
    }

    res.setHeader('Content-Length', String(size));
    return fs.createReadStream(file).pipe(res);
  } catch (e) { return next(e); }
});

export default router;
