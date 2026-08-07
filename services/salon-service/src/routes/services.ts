import { Router } from 'express';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { pool } from '../db';
import { config } from '../config';
import { authenticate, requireRole, HttpError } from '../middleware';
import { transcodeServiceVideo } from '../transcode';
import { shrinkImage } from '../image';
import { slugify, uniqueSlug } from '../slug';

const router = Router();
router.use(authenticate);

// ===== Видео-превью услуг: хранится на диске (volume service_media), в БД — путь.
// Тот же каталог монтируется read-only в nginx фронта и раздаётся как /media/*.
const MEDIA_SERVICES_DIR = path.join(config.MEDIA_DIR, 'services');
function ensureMediaDir(): void {
  try { fs.mkdirSync(MEDIA_SERVICES_DIR, { recursive: true }); } catch { /* создастся при первой записи / смонтированным volume */ }
}
ensureMediaDir();

const VIDEO_EXT: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};
const MAX_VIDEO_BYTES = 300 * 1024 * 1024; // 300 МБ

const IMAGE_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
// Телефоны отдают снимки на 12–20 МБ, и на 10 МБ загрузка упиралась в 413.
// Принимаем крупный исходник, а на диск кладём ужатую копию (см. shrinkImage).
const MAX_IMAGE_BYTES = 30 * 1024 * 1024; // 30 МБ

const uploadImage = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => { ensureMediaDir(); cb(null, MEDIA_SERVICES_DIR); },
    filename: (req, file, cb) => cb(null, `${req.params.id}.img.${IMAGE_EXT[file.mimetype] ?? 'bin'}`),
  }),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!(file.mimetype in IMAGE_EXT)) return cb(new Error('UNSUPPORTED_TYPE'));
    cb(null, true);
  },
}).single('image');

const uploadVideo = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => { ensureMediaDir(); cb(null, MEDIA_SERVICES_DIR); },
    // Оригинал = <service_id>.orig.<ext>; фоновый ffmpeg делает из него <service_id>.mp4.
    filename: (req, file, cb) => cb(null, `${req.params.id}.orig.${VIDEO_EXT[file.mimetype] ?? 'bin'}`),
  }),
  limits: { fileSize: MAX_VIDEO_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!(file.mimetype in VIDEO_EXT)) return cb(new Error('UNSUPPORTED_TYPE'));
    cb(null, true);
  },
}).single('video');

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.id, s.company_id, s.category_id, s.name, s.price, s.duration_minutes,
              s.color, s.tech_card_id, s.is_active, s.created_at, s.updated_at,
              s.description, s.video_path, s.video_mime, s.preview_enabled, s.video_status,
              s.show_in_menu, s.slug, s.image_path,
              c.name AS category_name
       FROM salons.services s
       LEFT JOIN salons.service_categories c ON c.id = s.category_id
       WHERE s.company_id = $1
       ORDER BY c.sort_order NULLS LAST, c.name NULLS LAST, s.name`,
      [req.auth!.company_id],
    );
    return res.json({ items: rows });
  } catch (e) { return next(e); }
});

const createSchema = z.object({
  name: z.string().min(1).max(200),
  category_id: z.string().uuid().nullable().optional(),
  price: z.number().nonnegative(),
  duration_minutes: z.number().int().positive(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  is_active: z.boolean().optional(),
  description: z.string().max(5000).nullable().optional(),
  show_in_menu: z.boolean().optional(),
});

async function slugTaken(companyId: string, slug: string, excludeId?: string): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM salons.services
     WHERE company_id = $1 AND slug = $2 AND ($3::uuid IS NULL OR id <> $3)`,
    [companyId, slug, excludeId ?? null],
  );
  return rows.length > 0;
}

router.post('/', requireRole(['owner', 'admin']), async (req, res, next) => {
  try {
    const input = createSchema.parse(req.body);
    const companyId = req.auth!.company_id;
    const slug = await uniqueSlug(
      slugify(input.name),
      (s) => slugTaken(companyId, s),
      `service-${Date.now().toString(36)}`,
    );
    const { rows } = await pool.query(
      `INSERT INTO salons.services
         (company_id, category_id, name, price, duration_minutes, color, is_active, show_in_menu, slug)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [
        companyId,
        input.category_id ?? null,
        input.name,
        input.price,
        input.duration_minutes,
        input.color ?? null,
        input.is_active ?? true,
        input.show_in_menu ?? false,
        slug,
      ],
    );
    return res.status(201).json(rows[0]);
  } catch (e: unknown) {
    if ((e as { code?: string }).code === '23503') {
      return next(new HttpError(400, 'invalid category_id', 'INVALID_CATEGORY'));
    }
    return next(e);
  }
});

const updateSchema = createSchema.partial();

router.patch('/:id', requireRole(['owner', 'admin']), async (req, res, next) => {
  try {
    const input = updateSchema.parse(req.body);
    const fields: string[] = [];
    const values: unknown[] = [req.auth!.company_id, req.params.id];
    for (const [k, v] of Object.entries(input)) {
      values.push(v);
      fields.push(`${k} = $${values.length}`);
    }
    if (!fields.length) return res.status(400).json({ error: 'no fields to update' });
    const { rows } = await pool.query(
      `UPDATE salons.services SET ${fields.join(', ')}
       WHERE company_id = $1 AND id = $2 RETURNING *`,
      values,
    );
    if (!rows[0]) return next(new HttpError(404, 'service not found'));
    return res.json(rows[0]);
  } catch (e) { return next(e); }
});

router.delete('/:id', requireRole(['owner', 'admin']), async (req, res, next) => {
  try {
    // Soft-delete: бронирования сохраняют ссылку на услугу и её историческую цену
    const { rows } = await pool.query(
      `UPDATE salons.services SET is_active = FALSE
       WHERE company_id = $1 AND id = $2 RETURNING id`,
      [req.auth!.company_id, req.params.id],
    );
    if (!rows[0]) return next(new HttpError(404, 'service not found'));
    return res.status(204).end();
  } catch (e) { return next(e); }
});

// ===== Видео-превью услуги =====
// POST /:id/preview-video — загрузить/заменить ролик (multipart, поле "video").
router.post('/:id/preview-video', requireRole(['owner', 'admin']), (req, res, next) => {
  uploadVideo(req, res, (err: unknown) => {
    if (err) {
      const e = err as { message?: string; code?: string };
      if (e.message === 'UNSUPPORTED_TYPE') return next(new HttpError(400, 'unsupported video type (mp4/webm/mov)', 'UNSUPPORTED_TYPE'));
      if (e.code === 'LIMIT_FILE_SIZE') return next(new HttpError(413, 'video too large', 'FILE_TOO_LARGE'));
      return next(err);
    }
    (async () => {
      const file = req.file;
      if (!file) throw new HttpError(400, 'no file (field "video")');
      const svc = await pool.query<{ video_path: string | null }>(
        `SELECT video_path FROM salons.services WHERE company_id = $1 AND id = $2`,
        [req.auth!.company_id, req.params.id],
      );
      if (!svc.rows[0]) {
        fs.unlink(file.path, () => {});
        throw new HttpError(404, 'service not found');
      }
      // Помечаем «в обработке» (старый ролик, если был, продолжает работать до готовности
      // нового) и запускаем конвертацию в фоне — ответ отдаём сразу.
      await pool.query(
        `UPDATE salons.services SET video_status = 'processing', updated_at = NOW()
         WHERE company_id = $1 AND id = $2`,
        [req.auth!.company_id, req.params.id],
      );
      const origRel = `services/${file.filename}`;
      void transcodeServiceVideo(req.auth!.company_id, req.params.id, origRel, file.mimetype);
      return res.json({ video_status: 'processing' });
    })().catch(next);
  });
});

// DELETE /:id/preview-video — убрать ролик и выключить превью.
router.delete('/:id/preview-video', requireRole(['owner', 'admin']), async (req, res, next) => {
  try {
    const svc = await pool.query<{ video_path: string | null }>(
      `SELECT video_path FROM salons.services WHERE company_id = $1 AND id = $2`,
      [req.auth!.company_id, req.params.id],
    );
    if (!svc.rows[0]) return next(new HttpError(404, 'service not found'));
    // Удаляем все видеофайлы услуги (mp4/оригинал/tmp), а не только текущий video_path.
    // Картинку карточки (`<id>.img.<ext>`) не трогаем — она живёт своей жизнью.
    try {
      for (const f of fs.readdirSync(MEDIA_SERVICES_DIR)) {
        if (f.startsWith(`${req.params.id}.`) && !f.startsWith(`${req.params.id}.img.`)) {
          fs.unlink(path.join(MEDIA_SERVICES_DIR, f), () => {});
        }
      }
    } catch { /* каталога может не быть */ }
    await pool.query(
      `UPDATE salons.services
         SET video_path = NULL, video_mime = NULL, preview_enabled = FALSE,
             video_status = NULL, updated_at = NOW()
       WHERE company_id = $1 AND id = $2`,
      [req.auth!.company_id, req.params.id],
    );
    return res.status(204).end();
  } catch (e) { return next(e); }
});

// ===== Изображение услуги (карточка каталога /services) =====
// POST /:id/image — загрузить/заменить (multipart, поле "image").
router.post('/:id/image', requireRole(['owner', 'admin']), (req, res, next) => {
  uploadImage(req, res, (err: unknown) => {
    if (err) {
      const e = err as { message?: string; code?: string };
      if (e.message === 'UNSUPPORTED_TYPE') return next(new HttpError(400, 'Формат не поддерживается — нужен JPEG, PNG или WebP', 'UNSUPPORTED_TYPE'));
      if (e.code === 'LIMIT_FILE_SIZE') return next(new HttpError(413, 'Изображение больше 30 МБ', 'FILE_TOO_LARGE'));
      return next(err);
    }
    (async () => {
      const file = req.file;
      if (!file) throw new HttpError(400, 'no file (field "image")');
      // Ужимаем до записи пути в БД — карточке каталога не нужен исходник с телефона.
      await shrinkImage(file.path);
      const rel = `services/${file.filename}`;
      const { rows } = await pool.query(
        `UPDATE salons.services SET image_path = $3, updated_at = NOW()
         WHERE company_id = $1 AND id = $2 RETURNING image_path`,
        [req.auth!.company_id, req.params.id, rel],
      );
      if (!rows[0]) {
        fs.unlink(file.path, () => {});
        throw new HttpError(404, 'service not found');
      }
      // Старый файл с другим расширением не должен затенять новый
      for (const ext of Object.values(IMAGE_EXT)) {
        if (`${req.params.id}.img.${ext}` !== file.filename) {
          fs.unlink(path.join(MEDIA_SERVICES_DIR, `${req.params.id}.img.${ext}`), () => {});
        }
      }
      return res.json({ image_path: rel });
    })().catch(next);
  });
});

// DELETE /:id/image — убрать изображение.
router.delete('/:id/image', requireRole(['owner', 'admin']), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `UPDATE salons.services SET image_path = NULL, updated_at = NOW()
       WHERE company_id = $1 AND id = $2 RETURNING id`,
      [req.auth!.company_id, req.params.id],
    );
    if (!rows[0]) return next(new HttpError(404, 'service not found'));
    for (const ext of Object.values(IMAGE_EXT)) {
      fs.unlink(path.join(MEDIA_SERVICES_DIR, `${req.params.id}.img.${ext}`), () => {});
    }
    return res.status(204).end();
  } catch (e) { return next(e); }
});

// ===== Сотрудники, выполняющие услугу (с индивидуальной ценой) =====
// GET — все активные мастера + отметка assigned и кастомная цена/длительность для этой услуги.
router.get('/:id/masters', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT m.id AS master_id, m.display_name,
              (ms.master_id IS NOT NULL) AS assigned,
              ms.custom_price::float8 AS custom_price,
              ms.custom_duration_minutes AS custom_duration_minutes
       FROM salons.masters m
       LEFT JOIN salons.master_services ms
              ON ms.master_id = m.id AND ms.service_id = $2
       WHERE m.company_id = $1 AND m.is_active = TRUE
       ORDER BY m.sort_order, m.display_name`,
      [req.auth!.company_id, req.params.id],
    );
    return res.json({ items: rows });
  } catch (e) { return next(e); }
});

const assignMastersSchema = z.object({
  assignments: z.array(z.object({
    master_id: z.string().uuid(),
    custom_price: z.number().nonnegative().nullable().optional(),
    custom_duration_minutes: z.number().int().positive().nullable().optional(),
  })).max(200),
});

// PUT — заменяет набор мастеров услуги (и их кастомные цены) целиком.
router.put('/:id/masters', requireRole(['owner', 'admin']), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { assignments } = assignMastersSchema.parse(req.body);
    const companyId = req.auth!.company_id;
    const serviceId = req.params.id;
    const svc = await client.query(
      `SELECT id FROM salons.services WHERE company_id = $1 AND id = $2`,
      [companyId, serviceId],
    );
    if (!svc.rows[0]) return next(new HttpError(404, 'service not found'));
    await client.query('BEGIN');
    await client.query(`DELETE FROM salons.master_services WHERE service_id = $1`, [serviceId]);
    for (const a of assignments) {
      await client.query(
        `INSERT INTO salons.master_services (master_id, service_id, custom_price, custom_duration_minutes)
         SELECT $1, $2, $3, $4
         WHERE EXISTS (SELECT 1 FROM salons.masters WHERE id = $1 AND company_id = $5)
         ON CONFLICT (master_id, service_id) DO UPDATE
           SET custom_price = EXCLUDED.custom_price,
               custom_duration_minutes = EXCLUDED.custom_duration_minutes`,
        [a.master_id, serviceId, a.custom_price ?? null, a.custom_duration_minutes ?? null, companyId],
      );
    }
    await client.query('COMMIT');
    return res.json({ ok: true, count: assignments.length });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    return next(e);
  } finally {
    client.release();
  }
});

export default router;
