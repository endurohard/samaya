import { Router, type Request } from 'express';
import { pool } from '../db';
import { config } from '../config';
import { HttpError } from '../middleware';

const router = Router();

function getCompanyId(req: Request): string {
  const id = (req.query.company_id as string | undefined) ?? config.DEFAULT_COMPANY_ID;
  if (!id) throw new HttpError(400, 'company_id required (no default configured)');
  return id;
}

router.get('/services', async (req, res, next) => {
  try {
    const company_id = getCompanyId(req);
    const { rows } = await pool.query(
      `SELECT s.id, s.name, s.price, s.duration_minutes, s.color,
              c.id AS category_id, c.name AS category_name
       FROM salons.services s
       LEFT JOIN salons.service_categories c ON c.id = s.category_id
       WHERE s.company_id = $1 AND s.is_active = TRUE
       ORDER BY c.sort_order NULLS LAST, c.name NULLS LAST, s.name`,
      [company_id],
    );
    return res.json({ items: rows });
  } catch (e) { return next(e); }
});

// Превью услуги для публичной страницы-плеера (/service.html?id=...).
// Отдаём только услуги с загруженным роликом (preview_enabled) и активные.
router.get('/services/:id/preview', async (req, res, next) => {
  try {
    const company_id = getCompanyId(req);
    const { rows } = await pool.query(
      `SELECT s.id, s.name, s.description, s.price::float8 AS price,
              s.duration_minutes, s.video_path, s.video_mime
       FROM salons.services s
       WHERE s.company_id = $1 AND s.id = $2
         AND s.is_active = TRUE AND s.preview_enabled = TRUE AND s.video_path IS NOT NULL`,
      [company_id, req.params.id],
    );
    const s = rows[0];
    if (!s) throw new HttpError(404, 'preview not found');
    return res.json({
      id: s.id,
      name: s.name,
      description: s.description,
      price: s.price,
      duration_minutes: s.duration_minutes,
      video_url: `/media/${s.video_path}`,
      video_mime: s.video_mime,
    });
  } catch (e) { return next(e); }
});

router.get('/masters', async (req, res, next) => {
  try {
    const company_id = getCompanyId(req);
    const { rows } = await pool.query(
      `SELECT m.id, m.display_name, m.specialization, m.avatar_url, m.sort_order
       FROM salons.masters m
       WHERE m.company_id = $1 AND m.is_active = TRUE
       ORDER BY m.sort_order, m.display_name`,
      [company_id],
    );
    return res.json({ items: rows });
  } catch (e) { return next(e); }
});

router.get('/masters/:id/services', async (req, res, next) => {
  try {
    const company_id = getCompanyId(req);
    const { rows } = await pool.query(
      `SELECT s.id, s.name,
              COALESCE(ms.custom_price, s.price) AS price,
              COALESCE(ms.custom_duration_minutes, s.duration_minutes) AS duration_minutes,
              s.color
       FROM salons.master_services ms
       JOIN salons.services s ON s.id = ms.service_id
       JOIN salons.masters m  ON m.id = ms.master_id
       WHERE m.company_id = $1 AND m.id = $2 AND s.is_active = TRUE
       ORDER BY s.name`,
      [company_id, req.params.id],
    );
    return res.json({ items: rows });
  } catch (e) { return next(e); }
});

export default router;
