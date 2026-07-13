import { Router } from 'express';
import { z } from 'zod';
import { isoDate } from '../validators';
import type { PoolClient } from 'pg';
import { pool } from '../db';
import { authenticate, requireRole, HttpError } from '../middleware';
import { config } from '../config';

const router = Router();
router.use(authenticate);

// FIFO-списание qty единиц product со склада. Возвращает сколько списано и стоимость.
// Если на складе меньше — списываем сколько есть, флаг insufficient=true.
async function consumeFifo(
  client: PoolClient,
  companyId: string,
  productId: string,
  warehouseId: string,
  qtyToConsume: number,
  sourceType: string,
  sourceId: string,
  notes: string | null,
): Promise<{ consumed: number; totalCost: number; insufficient: boolean }> {
  let remaining = qtyToConsume;
  let totalCost = 0;
  const lotsRes = await client.query(
    `SELECT id, qty_remaining::float8 AS qty_remaining, unit_cost::float8 AS unit_cost
     FROM inventory.stock_lots
     WHERE company_id = $1 AND product_id = $2 AND warehouse_id = $3 AND qty_remaining > 0
     ORDER BY received_at ASC, id ASC
     FOR UPDATE`,
    [companyId, productId, warehouseId],
  );
  for (const lot of lotsRes.rows) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, Number(lot.qty_remaining));
    if (take <= 0) continue;
    const upd = await client.query(
      `UPDATE inventory.stock_lots SET qty_remaining = qty_remaining - $1
       WHERE id = $2 AND qty_remaining >= $1`,
      [take, lot.id],
    );
    if (upd.rowCount !== 1) continue;
    await client.query(
      `INSERT INTO inventory.stock_movements
         (company_id, product_id, lot_id, warehouse_id, movement_type, qty,
          unit_cost, source_type, source_id, notes)
       VALUES ($1, $2, $3, $4, 'consumption', $5, $6, $7, $8, $9)`,
      [companyId, productId, lot.id, warehouseId, -take, lot.unit_cost, sourceType, sourceId, notes],
    );
    remaining -= take;
    totalCost += take * Number(lot.unit_cost);
  }
  return { consumed: qtyToConsume - remaining, totalCost, insufficient: remaining > 0 };
}

// Lots: партии конкретного продукта, ordered by FIFO (received_at)
router.get('/lots', async (req, res, next) => {
  try {
    const productId = req.query.product_id;
    if (!productId || typeof productId !== 'string') {
      return res.status(400).json({ error: 'product_id required' });
    }
    const { rows } = await pool.query(
      `SELECT
         l.id, l.product_id, l.warehouse_id, l.supplier_id, l.source_invoice_id,
         l.qty_received::float8 AS qty_received,
         l.qty_remaining::float8 AS qty_remaining,
         l.unit_cost::float8 AS unit_cost,
         l.received_at, l.expires_at,
         s.name AS supplier_name
       FROM inventory.stock_lots l
       LEFT JOIN inventory.suppliers s ON s.id = l.supplier_id
       WHERE l.company_id = $1 AND l.product_id = $2
       ORDER BY l.received_at DESC
       LIMIT 200`,
      [req.auth!.company_id, productId],
    );
    res.json({ items: rows });
  } catch (e) { next(e); }
});

// Movements: журнал движений
router.get('/movements', async (req, res, next) => {
  try {
    const productId = req.query.product_id as string | undefined;
    const params: unknown[] = [req.auth!.company_id];
    let where = `m.company_id = $1`;
    if (productId) {
      params.push(productId);
      where += ` AND m.product_id = $${params.length}`;
    }
    const { rows } = await pool.query(
      `SELECT
         m.id, m.product_id, p.name AS product_name, p.unit AS product_unit,
         m.lot_id, m.warehouse_id, m.movement_type,
         m.qty::float8 AS qty,
         m.unit_cost::float8 AS unit_cost,
         m.source_type, m.source_id, m.notes, m.created_at
       FROM inventory.stock_movements m
       LEFT JOIN inventory.products p ON p.id = m.product_id
       WHERE ${where}
       ORDER BY m.created_at DESC
       LIMIT 200`,
      params,
    );
    res.json({ items: rows });
  } catch (e) { next(e); }
});

// ===== POST /consumption — ручное списание (сменное / по факту) =====
// Используется для расходников с tracking_mode='manual'.
// Принимает массив items: [{product_id, qty, note?}], опц master_id (для отчётности).
const consumptionSchema = z.object({
  master_id: z.string().uuid().nullable().optional(),
  consumed_at: isoDate().optional(),
  shift_note: z.string().max(500).optional(),
  items: z.array(z.object({
    product_id: z.string().uuid(),
    qty: z.number().positive(),
    note: z.string().max(200).optional(),
  })).min(1).max(50),
});

router.post('/consumption', requireRole(['owner', 'admin', 'master']), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const input = consumptionSchema.parse(req.body);
    await client.query('BEGIN');
    // Берём дефолтный склад
    const wh = await client.query(
      `SELECT id FROM inventory.warehouses WHERE company_id = $1 ORDER BY is_default DESC, created_at ASC LIMIT 1`,
      [req.auth!.company_id],
    );
    const warehouseId = wh.rows[0]?.id || config.DEFAULT_WAREHOUSE_ID;
    if (!warehouseId) throw new HttpError(500, 'no warehouse configured');

    // Уникальный source_id для всей сессии списания (idempotency).
    const groupRes = await client.query(`SELECT uuid_generate_v4() AS id`);
    const sessionId: string = groupRes.rows[0].id;

    const results = [];
    let totalCostAll = 0;
    for (const item of input.items) {
      const r = await consumeFifo(
        client,
        req.auth!.company_id,
        item.product_id,
        warehouseId,
        item.qty,
        'manual_consumption',
        sessionId,
        [
          input.shift_note ? `Смена: ${input.shift_note}` : null,
          input.master_id ? `мастер ${input.master_id}` : null,
          item.note,
        ].filter(Boolean).join(' · ') || null,
      );
      results.push({ product_id: item.product_id, ...r });
      totalCostAll += r.totalCost;
    }
    await client.query('COMMIT');
    return res.status(201).json({
      session_id: sessionId,
      master_id: input.master_id ?? null,
      consumed_at: input.consumed_at ?? null,
      total_cost: totalCostAll,
      items: results,
    });
  } catch (e) {
    await client.query('ROLLBACK');
    return next(e);
  } finally {
    client.release();
  }
});

// ===== POST /inventory-check — инвентаризация (разница факт/учёт) =====
// Принимает items: [{product_id, actual_qty}]. По каждому считает разницу с
// текущим stock_qty и пишет movement с типом 'adjustment' (qty signed).
const inventoryCheckSchema = z.object({
  checked_at: isoDate().optional(),
  note: z.string().max(500).optional(),
  items: z.array(z.object({
    product_id: z.string().uuid(),
    actual_qty: z.number().nonnegative(),
  })).min(1).max(200),
});

router.post('/inventory-check', requireRole(['owner', 'admin']), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const input = inventoryCheckSchema.parse(req.body);
    await client.query('BEGIN');
    const wh = await client.query(
      `SELECT id FROM inventory.warehouses WHERE company_id = $1 ORDER BY is_default DESC, created_at ASC LIMIT 1`,
      [req.auth!.company_id],
    );
    const warehouseId = wh.rows[0]?.id || config.DEFAULT_WAREHOUSE_ID;
    if (!warehouseId) throw new HttpError(500, 'no warehouse configured');

    const groupRes = await client.query(`SELECT uuid_generate_v4() AS id`);
    const checkSessionId: string = groupRes.rows[0].id;

    const variances = [];
    for (const item of input.items) {
      // Текущий stock по продукту (из всех партий)
      const cur = await client.query(
        `SELECT COALESCE(SUM(qty_remaining), 0)::float8 AS stock,
                COALESCE(AVG(unit_cost), 0)::float8 AS avg_cost
         FROM inventory.stock_lots
         WHERE company_id = $1 AND product_id = $2 AND qty_remaining > 0`,
        [req.auth!.company_id, item.product_id],
      );
      const stockQty = Number(cur.rows[0].stock || 0);
      const variance = item.actual_qty - stockQty;
      if (Math.abs(variance) < 0.001) continue; // ничего не делаем

      if (variance < 0) {
        // Недостача — FIFO writeoff на |variance|
        await consumeFifo(
          client,
          req.auth!.company_id,
          item.product_id,
          warehouseId,
          Math.abs(variance),
          'inventory_writeoff',
          checkSessionId,
          input.note ? `Инвентаризация: ${input.note}` : 'Инвентаризация: недостача',
        );
      } else {
        // Излишек — создаём новую партию с unit_cost=avg или 0
        const avgCost = Number(cur.rows[0].avg_cost) || 0;
        await client.query(
          `INSERT INTO inventory.stock_lots
             (company_id, product_id, warehouse_id, qty_received, qty_remaining,
              unit_cost, notes)
           VALUES ($1, $2, $3, $4, $4, $5, $6)`,
          [req.auth!.company_id, item.product_id, warehouseId, variance, avgCost,
           'Инвентаризация: излишек'],
        );
        await client.query(
          `INSERT INTO inventory.stock_movements
             (company_id, product_id, warehouse_id, movement_type, qty,
              unit_cost, source_type, source_id, notes)
           VALUES ($1, $2, $3, 'adjustment', $4, $5, 'inventory_surplus', $6, $7)`,
          [req.auth!.company_id, item.product_id, warehouseId, variance, avgCost,
           checkSessionId, input.note ? `Инвентаризация: ${input.note}` : 'Инвентаризация: излишек'],
        );
      }
      variances.push({ product_id: item.product_id, expected: stockQty, actual: item.actual_qty, variance });
    }
    await client.query('COMMIT');
    return res.status(201).json({
      check_session_id: checkSessionId,
      checked_at: input.checked_at ?? null,
      total_changes: variances.length,
      variances,
    });
  } catch (e) {
    await client.query('ROLLBACK');
    return next(e);
  } finally {
    client.release();
  }
});

// ===== Отчёт по товарам (расход за период) =====
const reportSchema = z.object({ from: isoDate(), to: isoDate() });
router.get('/consumption-report', async (req, res, next) => {
  try {
    const q = reportSchema.parse(req.query);
    const { rows } = await pool.query(
      `SELECT m.product_id,
              p.name AS product_name,
              p.unit,
              COALESCE(SUM(-m.qty), 0)::float8                              AS qty,
              COALESCE(SUM(-m.qty * COALESCE(m.unit_cost, 0)), 0)::float8   AS cost
       FROM inventory.stock_movements m
       JOIN inventory.products p ON p.id = m.product_id
       WHERE m.company_id = $1
         AND m.movement_type = 'consumption'
         AND m.created_at >= $2::date AND m.created_at < ($3::date + INTERVAL '1 day')
       GROUP BY m.product_id, p.name, p.unit
       HAVING SUM(-m.qty) > 0
       ORDER BY cost DESC`,
      [req.auth!.company_id, q.from, q.to],
    );
    return res.json({ items: rows });
  } catch (e) { return next(e); }
});

export default router;
