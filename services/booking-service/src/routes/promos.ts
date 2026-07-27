import { Router } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';
import { isoDate } from '../validators';
import { pool } from '../db';
import { authenticate, requireRole, HttpError } from '../middleware';

const router = Router();
router.use(authenticate);

// Скидка у акции ровно одна: процент ИЛИ сумма в ₽ (купон «на 1000 ₽»).
// promotion_services ограничивает применимые услуги (пусто = любые).
// promo_coupons — индивидуальные ссылки /promo/<token> с воронкой
// issued → opened → claimed → used (мониторинг набора аудитории).

const PROMO_FIELDS = `p.id, p.code, p.name, p.discount_pct::float8 AS discount_pct,
       p.discount_amount::float8 AS discount_amount,
       p.valid_from, p.valid_to, p.max_uses, p.used_count, p.is_active, p.created_at`;

async function promoWithExtras(companyId: string, promoId?: string) {
  const { rows } = await pool.query(
    `SELECT ${PROMO_FIELDS},
            COALESCE(sv.ids, '[]'::json) AS service_ids,
            COALESCE(cs.issued, 0)::int AS coupons_issued,
            COALESCE(cs.opened, 0)::int AS coupons_opened,
            COALESCE(cs.claimed, 0)::int AS coupons_claimed,
            COALESCE(cs.used, 0)::int AS coupons_used
     FROM bookings.promotions p
     LEFT JOIN LATERAL (
       SELECT json_agg(ps.service_id) AS ids
       FROM bookings.promotion_services ps WHERE ps.promo_id = p.id
     ) sv ON TRUE
     LEFT JOIN LATERAL (
       SELECT COUNT(*) AS issued,
              COUNT(*) FILTER (WHERE c.status IN ('opened','claimed','used')) AS opened,
              COUNT(*) FILTER (WHERE c.status IN ('claimed','used')) AS claimed,
              COUNT(*) FILTER (WHERE c.status = 'used') AS used
       FROM bookings.promo_coupons c WHERE c.promo_id = p.id
     ) cs ON TRUE
     WHERE p.company_id = $1 ${promoId ? 'AND p.id = $2' : ''}
     ORDER BY p.created_at DESC`,
    promoId ? [companyId, promoId] : [companyId],
  );
  return rows;
}

// ===== List =====
router.get('/', async (req, res, next) => {
  try {
    return res.json({ items: await promoWithExtras(req.auth!.company_id) });
  } catch (e) { return next(e); }
});

// ===== Check (validate a code) =====
router.get('/check', async (req, res, next) => {
  try {
    const code = String(req.query.code ?? '').trim().toUpperCase();
    if (!code) return next(new HttpError(400, 'code required'));
    const today = new Date().toISOString().slice(0, 10);
    const { rows } = await pool.query(
      `SELECT ${PROMO_FIELDS}
       FROM bookings.promotions p
       WHERE p.company_id = $1 AND p.code = $2`,
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
const discountFields = {
  discount_pct: z.number().positive().max(100).nullable().optional(),
  discount_amount: z.number().positive().max(10_000_000).nullable().optional(),
};
const createSchema = z.object({
  code: z.string().min(2).max(32).transform((s) => s.toUpperCase()),
  name: z.string().min(1).max(200),
  ...discountFields,
  valid_from: isoDate().nullable().optional(),
  valid_to: isoDate().nullable().optional(),
  max_uses: z.number().int().positive().nullable().optional(),
  service_ids: z.array(z.string().uuid()).max(500).optional(),
}).refine((d) => (d.discount_pct != null) !== (d.discount_amount != null), {
  message: 'exactly one of discount_pct / discount_amount required',
});

async function replacePromoServices(promoId: string, serviceIds: string[]): Promise<void> {
  await pool.query(`DELETE FROM bookings.promotion_services WHERE promo_id = $1`, [promoId]);
  if (serviceIds.length) {
    await pool.query(
      `INSERT INTO bookings.promotion_services (promo_id, service_id)
       SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`,
      [promoId, serviceIds],
    );
  }
}

router.post('/', requireRole(['owner', 'admin']), async (req, res, next) => {
  try {
    const input = createSchema.parse(req.body);
    const { rows } = await pool.query(
      `INSERT INTO bookings.promotions
         (company_id, code, name, discount_pct, discount_amount, valid_from, valid_to, max_uses)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [req.auth!.company_id, input.code, input.name,
       input.discount_pct ?? null, input.discount_amount ?? null,
       input.valid_from ?? null, input.valid_to ?? null, input.max_uses ?? null],
    );
    if (input.service_ids?.length) await replacePromoServices(rows[0].id, input.service_ids);
    const [promo] = await promoWithExtras(req.auth!.company_id, rows[0].id);
    return res.status(201).json(promo);
  } catch (e: unknown) {
    if ((e as { code?: string }).code === '23505') return next(new HttpError(409, 'code already exists', 'PROMO_CODE_EXISTS'));
    return next(e);
  }
});

// ===== Update =====
const updateSchema = z.object({
  code: z.string().min(2).max(32).transform((s) => s.toUpperCase()).optional(),
  name: z.string().min(1).max(200).optional(),
  ...discountFields,
  valid_from: isoDate().nullable().optional(),
  valid_to: isoDate().nullable().optional(),
  max_uses: z.number().int().positive().nullable().optional(),
  service_ids: z.array(z.string().uuid()).max(500).optional(),
  is_active: z.boolean().optional(),
});

router.patch('/:id', requireRole(['owner', 'admin']), async (req, res, next) => {
  try {
    const input = updateSchema.parse(req.body);
    const { service_ids, ...cols } = input;
    // Смена типа скидки: указание одного обнуляет другой.
    if (cols.discount_pct != null) cols.discount_amount = null;
    if (cols.discount_amount != null) cols.discount_pct = null;
    const fields: string[] = [];
    const vals: unknown[] = [req.auth!.company_id, req.params.id];
    for (const [k, v] of Object.entries(cols)) {
      vals.push(v);
      fields.push(`${k} = $${vals.length}`);
    }
    if (fields.length) {
      const { rows } = await pool.query(
        `UPDATE bookings.promotions SET ${fields.join(', ')}
         WHERE company_id = $1 AND id = $2 RETURNING id`,
        vals,
      );
      if (!rows.length) return next(new HttpError(404, 'not found'));
    }
    if (service_ids) await replacePromoServices(req.params.id, service_ids);
    const [promo] = await promoWithExtras(req.auth!.company_id, req.params.id);
    if (!promo) return next(new HttpError(404, 'not found'));
    return res.json(promo);
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

// ===== Индивидуальные купоны-ссылки =====
const couponsCreateSchema = z.object({
  count: z.number().int().min(1).max(200),
  label: z.string().max(200).nullable().optional(),
});

// POST /:id/coupons — сгенерировать N ссылок
router.post('/:id/coupons', requireRole(['owner', 'admin']), async (req, res, next) => {
  try {
    const { count, label } = couponsCreateSchema.parse(req.body);
    const promo = await pool.query(
      `SELECT id FROM bookings.promotions WHERE company_id = $1 AND id = $2`,
      [req.auth!.company_id, req.params.id],
    );
    if (!promo.rows.length) return next(new HttpError(404, 'promo not found'));
    const tokens = Array.from({ length: count }, () => crypto.randomBytes(8).toString('base64url'));
    const { rows } = await pool.query(
      `INSERT INTO bookings.promo_coupons (company_id, promo_id, token, label)
       SELECT $1, $2, unnest($3::text[]), $4
       RETURNING id, token, label, status, created_at`,
      [req.auth!.company_id, req.params.id, tokens, label ?? null],
    );
    return res.status(201).json({ items: rows });
  } catch (e) { return next(e); }
});

// GET /:id/coupons — список купонов акции (воронка + аудитория)
router.get('/:id/coupons', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, token, label, status, opened_at, claimed_at, used_at,
              client_name, client_phone, created_at
       FROM bookings.promo_coupons
       WHERE company_id = $1 AND promo_id = $2
       ORDER BY created_at DESC, token`,
      [req.auth!.company_id, req.params.id],
    );
    return res.json({ items: rows });
  } catch (e) { return next(e); }
});

// POST /coupons/:couponId/use — погасить купон (при визите клиента)
router.post('/coupons/:couponId/use', requireRole(['owner', 'admin']), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `UPDATE bookings.promo_coupons
       SET status = 'used', used_at = NOW()
       WHERE company_id = $1 AND id = $2 AND status <> 'used'
       RETURNING id, status, used_at`,
      [req.auth!.company_id, req.params.couponId],
    );
    if (!rows.length) return next(new HttpError(404, 'coupon not found or already used'));
    return res.json(rows[0]);
  } catch (e) { return next(e); }
});

// DELETE /coupons/:couponId — удалить невостребованный купон
router.delete('/coupons/:couponId', requireRole(['owner', 'admin']), async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM bookings.promo_coupons
       WHERE company_id = $1 AND id = $2 AND status IN ('issued', 'opened')`,
      [req.auth!.company_id, req.params.couponId],
    );
    if (!rowCount) return next(new HttpError(404, 'coupon not found (или уже с контактами — удалять нельзя)'));
    return res.status(204).send();
  } catch (e) { return next(e); }
});

export default router;
