---
type: concept
status: wip
last_verified: 2026-04-25
sources:
  - "Требование владельца, 2026-04-25: 'настроить поступление расходников на склад и добавлять расход к услугам, чтоб сверять остатки'"
  - "Аналог: food-flow `concepts/inventory-service` + migration 010_inventory_warehouse.sql + 018_kitchen_stations_fifo_1c.sql"
---

# Inventory + Tech Cards

Учёт расходников (гель, иглы, простыни, расходники для аппаратов) и **автосписание со склада при оказании услуги** через техкарты.

Без этого нельзя:
- посчитать **реальную себестоимость услуги** (а значит и маржу),
- понять, **когда заканчивается расходник**, до того как он реально кончился,
- провести **инвентаризацию** (сравнить факт vs система → найти расхождения/потери/воровство).

## Сущности

```
products (расходник)
├─ id, company_id
├─ name              — "Гель-проводник X" / "Простыня одноразовая"
├─ unit              — мл / шт / гр / уп
├─ category_id       — категория для отчётов
├─ min_stock         — порог уведомления
└─ is_consumable     — true (расходник) | false (товар на продажу)

stock_lots (партии прихода — FIFO)
├─ id, company_id, product_id, warehouse_id
├─ supplier_id       — кто поставил (контрагент)
├─ qty_received      — сколько пришло
├─ qty_remaining     — сколько осталось от партии (для FIFO списания)
├─ unit_cost         — себестоимость единицы (₽)
├─ received_at       — дата прихода
└─ expires_at        — срок годности (важно для медицинских расходников)

stock_movements (журнал движений)
├─ id, company_id, product_id, lot_id, warehouse_id
├─ type              — 'receipt' | 'consumption' | 'adjustment' | 'transfer' | 'writeoff'
├─ qty               — + (приход) или - (расход)
├─ source_type       — 'booking' | 'manual' | 'inventory_count' | 'supplier_invoice'
├─ source_id         — FK на запись/пересчёт/инвойс
├─ created_at, created_by

tech_cards (техкарта услуги — BOM)
├─ id, company_id, service_id
├─ version           — версия техкарты (история — старые услуги списываются по своей версии)
├─ valid_from
└─ items: [{ product_id, qty_per_service }]  — что и сколько уходит за одно оказание

warehouses
├─ id, company_id, name, location
└─ — для салона обычно один склад, но мастера могут иметь "свой" подсклад

inventory_counts (инвентаризации)
├─ id, company_id, warehouse_id, performed_at, performed_by
└─ items: [{ product_id, expected_qty, actual_qty, variance }]
```

## Сценарии

### 1. Поступление расходников
1. Владелец/админ: Финансы → Контрагенты → выбрать поставщика → создать `supplier_invoice` (накладная: дата, список product_id + qty + unit_cost).
2. По приходу создаётся `stock_lot` на каждую позицию + `stock_movement(type='receipt')`.
3. Финансовое отражение: расход денег с кассы/расчётного счёта (опционально, если оплачено сразу) — связка с [[#Финансы]] из [[dikidi-feature-map]].

### 2. Техкарта услуги
1. Настройки → Услуги → выбрать услугу → "Техкарта" → добавить позиции (product_id + qty_per_service).
2. Версионируется: при изменении создаётся новая `version`, старая остаётся для прошлых услуг.

### 3. Списание при оказании услуги (автосписание)
Когда `booking` переходит в статус `completed`:
1. Для каждой услуги в записи берём `tech_card` версии, актуальной на момент booking-а.
2. По каждой позиции техкарты: `qty_to_consume = qty_per_service * service_count`.
3. Списываем по **FIFO**: ищем `stock_lots` с `qty_remaining > 0`, отсортированные по `received_at ASC` (или по `expires_at ASC` для расходников со сроком годности — FEFO).
4. Атомарно: `UPDATE stock_lots SET qty_remaining = qty_remaining - X WHERE id = $1 AND qty_remaining >= X` (чтобы не уйти в минус под concurrent-запросами — см. food-flow `inventory.service.ts` deductByTechCards, прецедент в `decisions/2026-04-11-deep-audit` Phase 2).
5. Записываем `stock_movement(type='consumption', source_type='booking', source_id=booking_id)` по каждой партии.
6. Если расходника не хватает → ошибка, операцию `complete booking` блокируем (или предупреждение + допускаем минусовой остаток с флагом — обсудить).

### 4. Инвентаризация (сверка)
1. Админ: Товары → Инвентаризация → выбрать склад → система показывает текущие системные остатки.
2. Админ вводит фактические остатки.
3. Расхождения создают `stock_movement(type='adjustment')` — плюсовые или минусовые.
4. Финансовое отражение через `writeoff` статью расходов.

## Связь с другими модулями

- **[[../decisions/2026-04-25-mvp-scope]]** — этот концепт меняет scope, см. ADR-002 (создаётся).
- **`booking-service`** — триггерит автосписание при `complete`. Должен публиковать событие `booking.completed`, на которое подписан `inventory-service`. Outbox pattern обязательно — если inventory упал, мы НЕ должны терять списания (иначе остатки на складе разойдутся с реальностью).
- **`finance-service`** (Phase 1+) — supplier_invoice = расход денег; writeoff = расход в P&L; consumption по техкартам = себестоимость услуги (для подсчёта маржи).
- **`salon-service`** — техкарты привязаны к услугам, поэтому могут жить либо в salon-service (как часть услуги), либо в inventory-service (как BOM). Решение: техкарта — в inventory-service (это про склад), но в salon-service у услуги есть `tech_card_id` reference.

## Правила корректности (избегаем грабли food-flow)

1. **Все списания только через транзакцию с `qty_remaining >= X` guard в WHERE** — атомарно, без read-then-write race condition.
2. **Outbox pattern для `booking.completed`** — событие в outbox-таблицу в той же транзакции, что и сам complete; отдельный воркер публикует в брокер с retry. Не теряем списания при сбое RabbitMQ/Redis.
3. **Идемпотентность списания** — если событие пришло повторно (брокер at-least-once), `stock_movement` не создаётся дважды. Уникальный constraint `(source_type, source_id, product_id)`.
4. **Сроки годности (FEFO)** — для расходников с `expires_at` списание по FEFO (First-Expired-First-Out), а не FIFO.
5. **Multi-tenant изоляция** — `company_id` во всех таблицах, во всех WHERE. Если когда-то samaya станет SaaS, не должно быть утечек между салонами.

## Открытые вопросы

1. **Один склад или несколько?** Для одного салона обычно один. Но если у мастера свой кабинет с расходниками — мини-склады?
2. **Что делать, если расходника не хватает при complete?** Заблокировать complete / разрешить минусовой остаток с флагом / списать сколько есть и предупредить?
3. **Учёт по партиям в UI** — показывать ли пользователю, из какой партии списано, или достаточно агрегата по продукту? (Партии важны для финансов и срока годности, но в UI могут перегрузить).
4. **Перевод между складами** — нужен ли в Phase 1 или позже?
