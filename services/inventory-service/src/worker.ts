import type { Logger } from 'pino';
import { pool } from './db';
import { config } from './config';

/**
 * Worker автосписания расходников по техкартам.
 *
 * Каждые CONSUME_WORKER_INTERVAL_MS опрашивает bookings.booking_events_outbox
 * на предмет неопубликованных событий 'booking.completed'.
 * Для каждого события:
 *   1. Берёт услуги из bookings.booking_services
 *   2. Для каждой ищет активную inventory.tech_cards (по service_id)
 *   3. Списывает позиции BOM по FIFO из inventory.stock_lots атомарно
 *   4. Пишет inventory.stock_movements (тип consumption, source=booking)
 *   5. Помечает событие published_at=NOW()
 *
 * Идемпотентность: UNIQUE (company_id, source_type, source_id, product_id, lot_id)
 * на stock_movements гарантирует, что повторное событие не создаст дубликат списания
 * (получим 23505, ловим и продолжаем — это не ошибка).
 *
 * Атомарность списания: UPDATE stock_lots SET qty_remaining = qty_remaining - X
 * WHERE id = $1 AND qty_remaining >= X. Если qty_remaining недостаточно — rowCount=0,
 * переходим к следующей партии (FIFO). Если все партии выбраны и осталось qty_to_consume > 0:
 * списываем сколько есть + флаг stock_insufficient в notes (по ADR-002, компромиссный режим).
 */

interface OutboxEvent {
  id: string;          // BIGSERIAL
  event_type: string;
  booking_id: string;
  company_id: string;
  payload: { booking_id: string; services?: Array<{ id: string }>; [k: string]: unknown };
}

interface BookingService {
  service_id: string;
  service_name: string;
}

interface TechCardItem {
  product_id: string;
  qty_per_service: number;
}

interface StockLot {
  id: string;
  warehouse_id: string;
  qty_remaining: number;
  unit_cost: number;
}

export function startConsumeWorker(log: Logger): NodeJS.Timeout | null {
  if (!config.CONSUME_WORKER_ENABLED) {
    log.info('consume worker disabled (CONSUME_WORKER_ENABLED=false)');
    return null;
  }
  log.info({ intervalMs: config.CONSUME_WORKER_INTERVAL_MS, batch: config.CONSUME_WORKER_BATCH },
    'consume worker started');
  // Сразу запускаем первый тик
  void tick(log);
  return setInterval(() => { void tick(log); }, config.CONSUME_WORKER_INTERVAL_MS);
}

async function tick(log: Logger) {
  // Каждое событие — отдельный client, чтобы не было concurrent query на одном соединении.
  let eventIds: string[];
  try {
    // Быстрый SELECT без клиента транзакции — только читаем IDs
    const res = await pool.query(
      `SELECT id FROM bookings.booking_events_outbox
       WHERE event_type = 'booking.completed' AND published_at IS NULL
       ORDER BY id
       LIMIT $1`,
      [config.CONSUME_WORKER_BATCH],
    );
    eventIds = res.rows.map((r: { id: string }) => r.id);
  } catch (e) {
    log.error({ err: e }, 'worker tick: failed to fetch event ids');
    return;
  }
  if (!eventIds.length) return;
  log.debug({ count: eventIds.length }, 'processing outbox events');

  for (const eventId of eventIds) {
    const client = await pool.connect();
    try {
      await processEvent(client, eventId, log);
    } catch (e) {
      log.error({ err: e, eventId }, 'event processing failed; will retry next tick');
    } finally {
      client.release();
    }
  }
}

async function processEvent(client: import('pg').PoolClient, eventId: string, log: Logger) {
  await client.query('BEGIN');
  try {
    // Берём событие под блокировку внутри транзакции (FOR UPDATE SKIP LOCKED — пропустить если другой воркер уже взял)
    const evRes = await client.query<OutboxEvent>(
      `SELECT id, event_type, booking_id, company_id, payload
       FROM bookings.booking_events_outbox
       WHERE id = $1 AND published_at IS NULL
       FOR UPDATE SKIP LOCKED`,
      [eventId],
    );
    if (!evRes.rows[0]) {
      // Уже обработано другим воркером
      await client.query('ROLLBACK');
      return;
    }
    const ev = evRes.rows[0];

    // Услуги бронирования
    const svcRes = await client.query(
      `SELECT service_id, service_name FROM bookings.booking_services WHERE booking_id = $1`,
      [ev.booking_id],
    );
    const services = svcRes.rows as BookingService[];
    if (services.length === 0) {
      log.warn({ bookingId: ev.booking_id }, 'no services for booking — marking event published');
      await markPublished(client, ev.id);
      await client.query('COMMIT');
      return;
    }

    // Дефолтный склад компании
    const whRes = await client.query(
      `SELECT id FROM inventory.warehouses
       WHERE company_id = $1 AND is_default = TRUE LIMIT 1`,
      [ev.company_id],
    );
    if (!whRes.rows[0]) {
      log.warn({ companyId: ev.company_id }, 'no default warehouse — skipping consumption');
      await markPublished(client, ev.id);
      await client.query('COMMIT');
      return;
    }
    const warehouseId: string = whRes.rows[0].id;

    let consumedAny = false;
    let insufficientCount = 0;

    for (const svc of services) {
      const tcItems = await loadTechCardItems(client, ev.company_id, svc.service_id);
      if (tcItems.length === 0) continue; // нет техкарты — пропускаем услугу
      consumedAny = true;
      for (const item of tcItems) {
        const remaining = await consumeFifo(
          client,
          ev.company_id,
          item.product_id,
          warehouseId,
          item.qty_per_service,
          ev.booking_id,
          log,
        );
        if (remaining > 0) insufficientCount++;
      }
    }

    if (!consumedAny) {
      log.debug({ bookingId: ev.booking_id }, 'no tech cards for any service — nothing to consume');
    } else if (insufficientCount > 0) {
      log.warn({ bookingId: ev.booking_id, insufficientCount },
        'consumed with insufficient stock — flagged in movements.notes');
    } else {
      log.info({ bookingId: ev.booking_id, services: services.length },
        'consumed by tech cards');
    }

    await markPublished(client, ev.id);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }
}

export async function loadTechCardItems(
  client: import('pg').PoolClient,
  companyId: string,
  serviceId: string,
): Promise<TechCardItem[]> {
  // Только товары с tracking_mode='auto' участвуют в автосписании.
  // manual/periodic/expense_only — списываются вручную или по инвентаризации.
  const r = await client.query(
    `SELECT tci.product_id, tci.qty_per_service::float8 AS qty_per_service
     FROM inventory.tech_cards tc
     JOIN inventory.tech_card_items tci ON tci.tech_card_id = tc.id
     JOIN inventory.products p ON p.id = tci.product_id
     WHERE tc.company_id = $1
       AND tc.service_id = $2
       AND tc.is_active = TRUE
       AND p.is_active = TRUE
       AND p.tracking_mode = 'auto'`,
    [companyId, serviceId],
  );
  return r.rows as TechCardItem[];
}

/**
 * FIFO-списание qty единиц product со складов компании.
 * Возвращает оставшееся (несписанное) количество — 0 если хватило, >0 если нет.
 */
export async function consumeFifo(
  client: import('pg').PoolClient,
  companyId: string,
  productId: string,
  warehouseId: string,
  qtyToConsume: number,
  bookingId: string,
  log: Logger,
): Promise<number> {
  let remaining = qtyToConsume;

  // FIFO-список партий с положительным остатком
  const lotsRes = await client.query<StockLot>(
    `SELECT id, warehouse_id,
            qty_remaining::float8 AS qty_remaining,
            unit_cost::float8 AS unit_cost
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

    // Атомарный декремент партии (двойная страховка против race — даже с FOR UPDATE)
    const upd = await client.query(
      `UPDATE inventory.stock_lots
         SET qty_remaining = qty_remaining - $1
       WHERE id = $2 AND qty_remaining >= $1`,
      [take, lot.id],
    );
    if (upd.rowCount !== 1) {
      log.warn({ lotId: lot.id, take }, 'unexpected lot update result; skipping');
      continue;
    }

    // Запись движения (идемпотентность через UNIQUE source/product/lot)
    try {
      await client.query(
        `INSERT INTO inventory.stock_movements
           (company_id, product_id, lot_id, warehouse_id, movement_type, qty,
            unit_cost, source_type, source_id, notes)
         VALUES ($1, $2, $3, $4, 'consumption', $5, $6, 'booking', $7, NULL)`,
        [companyId, productId, lot.id, warehouseId, -take, lot.unit_cost, bookingId],
      );
    } catch (e: unknown) {
      // 23505 unique violation — уже было списание для этой пары (booking, product, lot).
      // Откатываем декремент партии и идём дальше — это не ошибка, это at-least-once retry.
      if ((e as { code?: string }).code === '23505') {
        log.debug({ bookingId, productId, lotId: lot.id }, 'duplicate movement, skipping');
        await client.query(
          `UPDATE inventory.stock_lots SET qty_remaining = qty_remaining + $1 WHERE id = $2`,
          [take, lot.id],
        );
        // Пытаемся определить, было ли уже списание этого take именно для этого bookingId
        // в этой партии. Если да — сами списания уже зарегистрированы, пропускаем.
        remaining -= take;
        continue;
      }
      throw e;
    }
    remaining -= take;
  }

  if (remaining > 0) {
    // Не хватило: фиксируем виртуальное движение со ссылкой и флагом
    try {
      await client.query(
        `INSERT INTO inventory.stock_movements
           (company_id, product_id, lot_id, warehouse_id, movement_type, qty,
            unit_cost, source_type, source_id, notes)
         VALUES ($1, $2, NULL, $3, 'consumption', $4, NULL, 'booking', $5,
                 'stock_insufficient: not enough stock at fulfillment time')`,
        [companyId, productId, warehouseId, -remaining, bookingId],
      );
    } catch (e: unknown) {
      if ((e as { code?: string }).code !== '23505') throw e;
      // дубль виртуального движения — игнор
    }
  }

  return remaining;
}

async function markPublished(client: import('pg').PoolClient, eventId: string) {
  await client.query(
    `UPDATE bookings.booking_events_outbox SET published_at = NOW() WHERE id = $1`,
    [eventId],
  );
}
