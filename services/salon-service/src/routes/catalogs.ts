// Каталоги услуг по ссылке (админ-API):
//   GET    /api/salons/catalogs                → список с составом
//   POST   /api/salons/catalogs                → создать (name, description?, service_ids?)
//   GET    /api/salons/catalogs/:id            → один каталог
//   PATCH  /api/salons/catalogs/:id            → имя / описание / вкл-выкл
//   DELETE /api/salons/catalogs/:id            → удалить (ссылка перестаёт открываться)
//   PUT    /api/salons/catalogs/:id/services   → заменить состав (порядок = порядок массива)
//   POST   /api/salons/catalogs/:id/services   → добавить услуги в конец
//   DELETE /api/salons/catalogs/:id/services/:serviceId → убрать услугу
//   POST   /api/salons/catalogs/:id/regenerate → новый токен (старая ссылка умирает)
// Публичная страница — /c/<token>, см. site.ts.
// Услуги чужой компании в состав не попадают: вставка идёт через
// SELECT ... WHERE company_id = $1, а не по пришедшим id напрямую.

import { Router } from 'express';
import { z } from 'zod';
import type { PoolClient } from 'pg';
import { pool } from '../db';
import { authenticate, requireRole, HttpError } from '../middleware';
import { newCatalogToken } from '../token';

const router = Router();
router.use(authenticate);

interface CatalogRow {
  id: string; company_id: string; name: string; description: string | null;
  token: string; is_active: boolean; views: number;
  created_at: string; updated_at: string;
  service_ids: string[]; items_count: number;
}

const CATALOG_SELECT = `
  SELECT c.id, c.company_id, c.name, c.description, c.token, c.is_active, c.views,
         c.created_at, c.updated_at,
         COALESCE(i.service_ids, '{}'::uuid[]) AS service_ids,
         COALESCE(array_length(i.service_ids, 1), 0) AS items_count
  FROM salons.service_catalogs c
  LEFT JOIN LATERAL (
    SELECT array_agg(ci.service_id ORDER BY ci.sort_order, ci.service_id) AS service_ids
    FROM salons.service_catalog_items ci WHERE ci.catalog_id = c.id
  ) i ON TRUE`;

async function getCatalog(companyId: string, id: string): Promise<CatalogRow | undefined> {
  const { rows } = await pool.query<CatalogRow>(
    `${CATALOG_SELECT} WHERE c.company_id = $1 AND c.id = $2`,
    [companyId, id],
  );
  return rows[0];
}

const idsSchema = z.array(z.string().uuid()).max(500);

// Заменить состав каталога внутри транзакции клиента. Порядок — порядок массива.
async function replaceItems(client: PoolClient, companyId: string, catalogId: string, ids: string[]): Promise<void> {
  await client.query(`DELETE FROM salons.service_catalog_items WHERE catalog_id = $1`, [catalogId]);
  if (!ids.length) return;
  await client.query(
    `INSERT INTO salons.service_catalog_items (catalog_id, service_id, sort_order)
     SELECT $1, s.id, x.ord
     FROM unnest($2::uuid[]) WITH ORDINALITY AS x(id, ord)
     JOIN salons.services s ON s.id = x.id AND s.company_id = $3
     ON CONFLICT DO NOTHING`,
    [catalogId, ids, companyId],
  );
}

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query<CatalogRow>(
      `${CATALOG_SELECT} WHERE c.company_id = $1 ORDER BY c.created_at DESC`,
      [req.auth!.company_id],
    );
    return res.json({ items: rows });
  } catch (e) { return next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const row = await getCatalog(req.auth!.company_id, req.params.id);
    if (!row) return next(new HttpError(404, 'catalog not found'));
    return res.json(row);
  } catch (e) { return next(e); }
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).nullable().optional(),
  service_ids: idsSchema.optional(),
});

router.post('/', requireRole(['owner', 'admin']), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const input = createSchema.parse(req.body);
    const companyId = req.auth!.company_id;
    await client.query('BEGIN');
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO salons.service_catalogs (company_id, name, description, token, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [companyId, input.name, input.description ?? null, newCatalogToken(), req.auth!.sub ?? null],
    );
    await replaceItems(client, companyId, rows[0].id, input.service_ids ?? []);
    await client.query('COMMIT');
    return res.status(201).json(await getCatalog(companyId, rows[0].id));
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    return next(e);
  } finally {
    client.release();
  }
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
  is_active: z.boolean().optional(),
});

router.patch('/:id', requireRole(['owner', 'admin']), async (req, res, next) => {
  try {
    const input = updateSchema.parse(req.body);
    const fields: string[] = [];
    const values: unknown[] = [req.auth!.company_id, req.params.id];
    for (const [k, v] of Object.entries(input)) {
      if (v === undefined) continue;
      values.push(v);
      fields.push(`${k} = $${values.length}`);
    }
    if (!fields.length) return next(new HttpError(400, 'no fields to update'));
    const { rows } = await pool.query(
      `UPDATE salons.service_catalogs SET ${fields.join(', ')}, updated_at = NOW()
       WHERE company_id = $1 AND id = $2 RETURNING id`,
      values,
    );
    if (!rows[0]) return next(new HttpError(404, 'catalog not found'));
    return res.json(await getCatalog(req.auth!.company_id, req.params.id));
  } catch (e) { return next(e); }
});

router.delete('/:id', requireRole(['owner', 'admin']), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `DELETE FROM salons.service_catalogs WHERE company_id = $1 AND id = $2 RETURNING id`,
      [req.auth!.company_id, req.params.id],
    );
    if (!rows[0]) return next(new HttpError(404, 'catalog not found'));
    return res.status(204).end();
  } catch (e) { return next(e); }
});

// Новый токен: старая ссылка перестаёт открываться (если разошлась не туда).
router.post('/:id/regenerate', requireRole(['owner', 'admin']), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `UPDATE salons.service_catalogs SET token = $3, views = 0, updated_at = NOW()
       WHERE company_id = $1 AND id = $2 RETURNING id`,
      [req.auth!.company_id, req.params.id, newCatalogToken()],
    );
    if (!rows[0]) return next(new HttpError(404, 'catalog not found'));
    return res.json(await getCatalog(req.auth!.company_id, req.params.id));
  } catch (e) { return next(e); }
});

const itemsSchema = z.object({ service_ids: idsSchema });

router.put('/:id/services', requireRole(['owner', 'admin']), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { service_ids } = itemsSchema.parse(req.body);
    const companyId = req.auth!.company_id;
    await client.query('BEGIN');
    const own = await client.query(
      `SELECT 1 FROM salons.service_catalogs WHERE company_id = $1 AND id = $2 FOR UPDATE`,
      [companyId, req.params.id],
    );
    if (!own.rows[0]) throw new HttpError(404, 'catalog not found');
    await replaceItems(client, companyId, req.params.id, service_ids);
    await client.query(`UPDATE salons.service_catalogs SET updated_at = NOW() WHERE id = $1`, [req.params.id]);
    await client.query('COMMIT');
    return res.json(await getCatalog(companyId, req.params.id));
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    return next(e);
  } finally {
    client.release();
  }
});

// Добавить услуги в конец; уже присутствующие пропускаются.
router.post('/:id/services', requireRole(['owner', 'admin']), async (req, res, next) => {
  try {
    const { service_ids } = itemsSchema.parse(req.body);
    const companyId = req.auth!.company_id;
    const own = await pool.query(
      `SELECT 1 FROM salons.service_catalogs WHERE company_id = $1 AND id = $2`,
      [companyId, req.params.id],
    );
    if (!own.rows[0]) return next(new HttpError(404, 'catalog not found'));
    await pool.query(
      `INSERT INTO salons.service_catalog_items (catalog_id, service_id, sort_order)
       SELECT $1, s.id,
              COALESCE((SELECT MAX(sort_order) FROM salons.service_catalog_items WHERE catalog_id = $1), 0) + x.ord
       FROM unnest($2::uuid[]) WITH ORDINALITY AS x(id, ord)
       JOIN salons.services s ON s.id = x.id AND s.company_id = $3
       ON CONFLICT DO NOTHING`,
      [req.params.id, service_ids, companyId],
    );
    await pool.query(`UPDATE salons.service_catalogs SET updated_at = NOW() WHERE id = $1`, [req.params.id]);
    return res.json(await getCatalog(companyId, req.params.id));
  } catch (e) { return next(e); }
});

router.delete('/:id/services/:serviceId', requireRole(['owner', 'admin']), async (req, res, next) => {
  try {
    const companyId = req.auth!.company_id;
    const { rows } = await pool.query(
      `DELETE FROM salons.service_catalog_items ci
       USING salons.service_catalogs c
       WHERE ci.catalog_id = c.id AND c.company_id = $1 AND c.id = $2 AND ci.service_id = $3
       RETURNING ci.service_id`,
      [companyId, req.params.id, req.params.serviceId],
    );
    if (!rows[0]) return next(new HttpError(404, 'service not in catalog'));
    await pool.query(`UPDATE salons.service_catalogs SET updated_at = NOW() WHERE id = $1`, [req.params.id]);
    return res.json(await getCatalog(companyId, req.params.id));
  } catch (e) { return next(e); }
});

export default router;
