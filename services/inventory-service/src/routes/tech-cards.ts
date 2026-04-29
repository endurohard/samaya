import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db';
import { authenticate, requireRole, HttpError } from '../middleware';

const router = Router();
router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    // Все услуги компании + (опционально) активная техкарта
    const { rows } = await pool.query(
      `SELECT
         s.id AS service_id, s.name AS service_name, s.is_active AS service_active,
         tc.id AS tech_card_id, tc.version, tc.is_active AS tech_card_active, tc.notes,
         COALESCE(
           (SELECT json_agg(json_build_object(
              'product_id', tci.product_id,
              'product_name', p.name,
              'product_unit', p.unit,
              'qty_per_service', tci.qty_per_service::float8
            ) ORDER BY p.name)
            FROM inventory.tech_card_items tci
            JOIN inventory.products p ON p.id = tci.product_id
            WHERE tci.tech_card_id = tc.id),
           '[]'::json
         ) AS items
       FROM salons.services s
       LEFT JOIN inventory.tech_cards tc
         ON tc.company_id = s.company_id
        AND tc.service_id = s.id
        AND tc.is_active = TRUE
       WHERE s.company_id = $1
       ORDER BY s.name`,
      [req.auth!.company_id],
    );
    res.json({ items: rows });
  } catch (e) { next(e); }
});

const upsertSchema = z.object({
  service_id: z.string().uuid(),
  notes: z.string().max(2000).nullable().optional(),
  items: z.array(z.object({
    product_id: z.string().uuid(),
    qty_per_service: z.number().positive(),
  })).min(1).max(100),
});

/**
 * PUT /api/inventory/tech-cards — создать новую активную версию ИЛИ переписать активную.
 * Версионирование: предыдущая активная помечается is_active=FALSE, создаётся новая с version+1.
 */
router.put('/', requireRole(['owner', 'admin']), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const input = upsertSchema.parse(req.body);
    const companyId = req.auth!.company_id;

    await client.query('BEGIN');

    // Проверка services принадлежит компании
    const svc = await client.query(
      `SELECT id FROM salons.services WHERE company_id = $1 AND id = $2`,
      [companyId, input.service_id],
    );
    if (!svc.rows[0]) throw new HttpError(400, 'service not found', 'INVALID_SERVICE');

    // Проверка product_ids принадлежат компании
    const productIds = input.items.map((i) => i.product_id);
    const prodRes = await client.query(
      `SELECT id FROM inventory.products WHERE company_id = $1 AND id = ANY($2::uuid[])`,
      [companyId, productIds],
    );
    if (prodRes.rows.length !== new Set(productIds).size) {
      throw new HttpError(400, 'some product ids invalid', 'INVALID_PRODUCTS');
    }

    // Деактивируем старую активную (если есть) — сначала, чтобы partial unique index не сработал
    await client.query(
      `UPDATE inventory.tech_cards SET is_active = FALSE
       WHERE company_id = $1 AND service_id = $2 AND is_active = TRUE`,
      [companyId, input.service_id],
    );

    // Версия = max(version) + 1
    const verRes = await client.query(
      `SELECT COALESCE(MAX(version), 0) + 1 AS next_version
       FROM inventory.tech_cards
       WHERE company_id = $1 AND service_id = $2`,
      [companyId, input.service_id],
    );

    const tcRes = await client.query(
      `INSERT INTO inventory.tech_cards (company_id, service_id, version, is_active, notes)
       VALUES ($1, $2, $3, TRUE, $4) RETURNING *`,
      [companyId, input.service_id, verRes.rows[0].next_version, input.notes ?? null],
    );
    const tc = tcRes.rows[0];

    // Items
    const valuesSql = input.items.map((_, i) => `($1, $${i * 2 + 2}, $${i * 2 + 3})`).join(', ');
    const valuesParams: unknown[] = [tc.id];
    input.items.forEach((it) => {
      valuesParams.push(it.product_id, it.qty_per_service);
    });
    await client.query(
      `INSERT INTO inventory.tech_card_items (tech_card_id, product_id, qty_per_service)
       VALUES ${valuesSql}`,
      valuesParams,
    );

    await client.query('COMMIT');
    res.status(201).json({ ...tc, items: input.items });
  } catch (e) {
    await client.query('ROLLBACK');
    next(e);
  } finally {
    client.release();
  }
});

export default router;
