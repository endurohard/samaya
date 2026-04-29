---
type: service
status: stable
last_verified: 2026-04-25
sources:
  - services/inventory-service/
  - database/migrations/004_inventory.sql
---

# inventory-service

Расходники, склад, FIFO-партии, техкарты услуг, автосписание по событиям booking-service. Phase 0b.

- **Порт**: 3005
- **БД**: схема `inventory`, читает также `bookings.*` (outbox + booking_services) и `salons.services`
- **Префикс**: `/api/inventory/*`
- **Worker автосписания**: фоновый поллинг outbox каждые `CONSUME_WORKER_INTERVAL_MS` (10s default)

## Ответственность

- CRUD расходников (`products`), поставщиков (`suppliers`), складов (`warehouses` — read-only пока).
- **Поступления** (`POST /receipts`): создаёт supplier_invoice + N stock_lots + N stock_movements в одной транзакции.
- **Партии** (FIFO): `stock_lots` с `qty_remaining`, индекс `idx_lots_fifo` partial WHERE qty_remaining > 0.
- **Журнал движений** (`stock_movements`): receipt/consumption/adjustment/writeoff с источником (`source_type`, `source_id`).
- **Техкарты услуг** (`tech_cards` + `tech_card_items`): BOM расходников per service, версионируемые. PUT создаёт новую активную, старая помечается `is_active=FALSE`.
- **Worker** (`src/worker.ts`): подписан на `bookings.booking_events_outbox` event_type=`booking.completed`, по техкарте каждой услуги бронирования FIFO-списывает расходники, помечает событие `published_at`.

## Endpoints

| Метод | Путь | Кто |
|---|---|---|
| GET/POST/PATCH/DELETE | /api/inventory/products[/:id] | auth (GET) / owner-admin (mutations) |
| GET/POST/PATCH | /api/inventory/suppliers[/:id] | auth / owner-admin |
| GET | /api/inventory/warehouses | auth |
| GET/POST | /api/inventory/receipts | auth / owner-admin |
| GET | /api/inventory/stock/lots?product_id= | auth |
| GET | /api/inventory/stock/movements?product_id= | auth |
| GET/PUT | /api/inventory/tech-cards | auth / owner-admin |
| GET | /health | внутренний |

## Таблицы (схема `inventory`)

См. `database/migrations/004_inventory.sql`.

| Таблица | Зачем |
|---|---|
| `products` | Расходник: name (UNIQUE per company), unit, category, min_stock, is_consumable, is_active |
| `warehouses` | Склады, partial UNIQUE на `is_default=TRUE` per company. Сид: «Основной склад» с детерминированным UUID для samaya. |
| `suppliers` | Контрагенты-поставщики (Чистовье, аптеки, ИП и т.п.) |
| `supplier_invoices` | Накладная: дата, номер, сумма (auto-сумма из items), warehouse, supplier |
| `stock_lots` | Партия прихода. `qty_received`/`qty_remaining`, `unit_cost`, `received_at`, `expires_at`. CHECK qty_remaining ≤ qty_received. Индексы FIFO (`received_at`) и FEFO (`expires_at`). |
| `stock_movements` | Журнал движений. type ∈ {receipt, consumption, adjustment, writeoff, transfer}. UNIQUE `(company_id, source_type, source_id, product_id, lot_id) WHERE source_*  IS NOT NULL` — **ключевая идемпотентность для worker'a**. |
| `tech_cards` | BOM услуги. `(company_id, service_id, version)` UNIQUE. Partial UNIQUE на `is_active=TRUE` — только одна активная версия per service. |
| `tech_card_items` | Композитный PK `(tech_card_id, product_id)`, `qty_per_service` |

## Worker автосписания

`src/worker.ts`. Запускается из `index.ts` через `setInterval`, в том же Node-процессе.

**Алгоритм одного тика:**

1. `SELECT ... FOR UPDATE SKIP LOCKED LIMIT N` — берёт пачку неопубликованных событий `booking.completed` из `bookings.booking_events_outbox`.
2. Для каждого события открывает транзакцию.
3. Загружает услуги из `bookings.booking_services` (snapshot на момент бронирования).
4. Для каждой услуги ищет активную техкарту в `inventory.tech_cards` по `service_id` + `is_active=TRUE`.
5. Для каждой позиции BOM делает FIFO-списание:
   - `SELECT ... FOR UPDATE` партий с `qty_remaining > 0` ORDER BY `received_at ASC`.
   - Атомарно: `UPDATE stock_lots SET qty_remaining = qty_remaining - X WHERE id = $1 AND qty_remaining >= X` — двойная страховка.
   - `INSERT stock_movements` с `source_type='booking'`, `source_id=booking_id`. Если 23505 (idempotency) — откатывает декремент партии и пропускает (это at-least-once retry, дубль — не ошибка).
6. Если не хватило остатка — записывает виртуальное movement с `lot_id=NULL` и `notes='stock_insufficient: ...'` (компромиссный режим из ADR-002).
7. `UPDATE booking_events_outbox SET published_at = NOW() WHERE id = $1`.
8. COMMIT.

При ошибке всё откатывается, событие остаётся неопубликованным — worker попробует ещё раз через `CONSUME_WORKER_INTERVAL_MS`.

## Ключевые архитектурные решения

- **Cross-schema READ** из `bookings.booking_events_outbox`, `bookings.booking_services`, `salons.services` — допустимо в Phase 0b (single DB, schema-per-service). При разнесении БД заменяется на RabbitMQ-подписку + API-вызовы.
- **In-process worker** в `inventory-service` (через `setInterval`). Не нужен отдельный процесс/контейнер для MVP. Вынос в отдельный worker-сервис — когда будет нагрузка.
- **Идемпотентность списания** через UNIQUE `(company_id, source_type, source_id, product_id, lot_id)` — нативный Postgres, не приложение. Гарантия at-least-once → exactly-once без распределённых транзакций.
- **Атомарный декремент** через `WHERE qty_remaining >= X` — даже если FOR UPDATE по какой-то причине не сработал, race не приведёт к минусу.
- **Soft-delete** через `is_active=FALSE` — все исторические партии и движения сохраняют ссылки.
- **Версионируемые техкарты**: PUT всегда создаёт новую активную (старую `is_active=FALSE`). Это гарантирует, что списания прошлых записей привязываются к версии техкарты, актуальной на их момент (через лог booking_services).
- **Default warehouse** через partial UNIQUE — не более одного `is_default=TRUE` per company. В worker'е используется как fallback.

## Связи

- [[user-service]] — JWT issuer.
- [[salon-service]] — `tech_cards.service_id` ссылается на `salons.services` (cross-schema без FK). Для UI «Техкарты» список услуг тянется через JOIN.
- [[booking-service]] — публикует события в `booking_events_outbox`. Worker читает их.
- [[../concepts/inventory-tech-cards]] — концептуальная модель домена.
- [[../decisions/2026-04-25-inventory-in-mvp]] — ADR-002, обоснование включения в Phase 0.

## Известные ограничения Phase 0b

- **Один склад per company** в UI и worker'е (warehouse_id определяется через `is_default=TRUE`). Мульти-склад поддержан в БД, но без UI-переключения.
- **Нет UI инвентаризаций** (count + adjustments) — есть только receipt и автосписание. Manual adjustment только через прямой SQL.
- **FEFO** (по сроку годности) поддержан в индексе, но worker всегда FIFO. Включить FEFO — добавить флаг в продукте/политике.
- **Worker отдельным процессом** не вынесен — вместе с API-сервером. При высокой нагрузке стоит вынести.
- **Outbox-публикация только для `booking.completed`**. `booking.canceled` (для возврата на склад) не обрабатывается — список услуг уже снапшотился, частичный возврат непрост. Реализуется в Phase 1.
- **Нет уведомлений** при stock_insufficient — только notes в movement. UI не показывает выделенно.
