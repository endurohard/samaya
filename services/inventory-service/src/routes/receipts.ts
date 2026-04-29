import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db';
import { authenticate, requireRole, HttpError } from '../middleware';

const router = Router();
router.use(authenticate);

const itemSchema = z.object({
  product_id: z.string().uuid(),
  qty: z.number().positive(),
  unit_cost: z.number().nonnegative().optional().default(0),
  expires_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

const createSchema = z.object({
  supplier_id: z.string().uuid().nullable().optional(),
  warehouse_id: z.string().uuid().optional(),
  invoice_number: z.string().max(100).nullable().optional(),
  invoice_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes: z.string().max(2000).nullable().optional(),
  items: z.array(itemSchema).min(1).max(500),
});

/**
 * POST /api/inventory/receipts — приход партии расходников.
 * Создаёт supplier_invoice + N stock_lots + N stock_movements (type=receipt)
 * в одной транзакции. Если warehouse_id не указан — берётся default склад компании.
 */
router.post('/', requireRole(['owner', 'admin']), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const input = createSchema.parse(req.body);
    const companyId = req.auth!.company_id;

    await client.query('BEGIN');

    // Определяем склад
    let warehouseId = input.warehouse_id;
    if (!warehouseId) {
      const wh = await client.query(
        `SELECT id FROM inventory.warehouses WHERE company_id = $1 AND is_default = TRUE LIMIT 1`,
        [companyId],
      );
      if (!wh.rows[0]) throw new HttpError(400, 'no default warehouse for company', 'NO_DEFAULT_WAREHOUSE');
      warehouseId = wh.rows[0].id;
    } else {
      const wh = await client.query(
        `SELECT id FROM inventory.warehouses WHERE company_id = $1 AND id = $2`,
        [companyId, warehouseId],
      );
      if (!wh.rows[0]) throw new HttpError(400, 'warehouse not found', 'INVALID_WAREHOUSE');
    }

    // Проверка product_ids принадлежат компании
    const productIds = input.items.map((i) => i.product_id);
    const productsRes = await client.query(
      `SELECT id FROM inventory.products WHERE company_id = $1 AND id = ANY($2::uuid[])`,
      [companyId, productIds],
    );
    if (productsRes.rows.length !== new Set(productIds).size) {
      throw new HttpError(400, 'some product ids invalid', 'INVALID_PRODUCTS');
    }

    const totalAmount = input.items.reduce((acc, it) => acc + it.qty * (it.unit_cost ?? 0), 0);

    // Накладная
    const invRes = await client.query(
      `INSERT INTO inventory.supplier_invoices
         (company_id, supplier_id, warehouse_id, invoice_number, invoice_date, total_amount, notes, created_by)
       VALUES ($1, $2, $3, $4, COALESCE($5::date, CURRENT_DATE), $6, $7, $8)
       RETURNING id, invoice_date, total_amount::float8 AS total_amount`,
      [
        companyId,
        input.supplier_id ?? null,
        warehouseId,
        input.invoice_number ?? null,
        input.invoice_date ?? null,
        totalAmount,
        input.notes ?? null,
        req.auth!.sub,
      ],
    );
    const invoice = invRes.rows[0];

    // Партии + движения
    const lotResults: unknown[] = [];
    for (const it of input.items) {
      const lotRes = await client.query(
        `INSERT INTO inventory.stock_lots
           (company_id, product_id, warehouse_id, supplier_id, source_invoice_id,
            qty_received, qty_remaining, unit_cost, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8::date)
         RETURNING id, product_id, qty_received::float8 AS qty_received, unit_cost::float8 AS unit_cost`,
        [
          companyId, it.product_id, warehouseId,
          input.supplier_id ?? null, invoice.id,
          it.qty, it.unit_cost ?? 0, it.expires_at ?? null,
        ],
      );
      const lot = lotRes.rows[0];
      lotResults.push(lot);

      await client.query(
        `INSERT INTO inventory.stock_movements
           (company_id, product_id, lot_id, warehouse_id, movement_type, qty,
            unit_cost, source_type, source_id, created_by)
         VALUES ($1, $2, $3, $4, 'receipt', $5, $6, 'supplier_invoice', $7, $8)`,
        [
          companyId, it.product_id, lot.id, warehouseId,
          it.qty, it.unit_cost ?? 0, invoice.id, req.auth!.sub,
        ],
      );
    }

    await client.query('COMMIT');
    res.status(201).json({
      invoice,
      lots: lotResults,
    });
  } catch (e) {
    await client.query('ROLLBACK');
    next(e);
  } finally {
    client.release();
  }
});

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         si.id, si.invoice_number, si.invoice_date, si.total_amount::float8 AS total_amount,
         si.notes, si.created_at,
         s.name AS supplier_name,
         w.name AS warehouse_name,
         (SELECT COUNT(*)::int FROM inventory.stock_lots sl WHERE sl.source_invoice_id = si.id) AS items_count
       FROM inventory.supplier_invoices si
       LEFT JOIN inventory.suppliers s ON s.id = si.supplier_id
       LEFT JOIN inventory.warehouses w ON w.id = si.warehouse_id
       WHERE si.company_id = $1
       ORDER BY si.invoice_date DESC, si.created_at DESC
       LIMIT 100`,
      [req.auth!.company_id],
    );
    res.json({ items: rows });
  } catch (e) { next(e); }
});

export default router;
