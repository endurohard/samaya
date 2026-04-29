---
type: meta
status: wip
last_verified: 2026-04-26
---

# Sources Map

Карта raw-sources → страницы вики, которые их покрывают. Обновляется при ingest. Используется lint-ом для поиска непокрытых источников.

## Внешние референсы

| Источник | Покрытие |
|---|---|
| DIKIDI Business UI (компания Samaya 1674757), скриншоты 2026-04-25 | [[concepts/dikidi-feature-map]] |
| `Wiki/attachments/dikidi/pass1/` (23 PNG) + `Wiki/attachments/dikidi/pass2/` (31 PNG) + `Wiki/attachments/dikidi/pass3/` (34 PNG, 2026-04-27, модалки + sub-tabs клиентов/настроек/товаров) | [[concepts/dikidi-screenshots-index]], [[concepts/dikidi-finance]], [[concepts/dikidi-feature-map]] |
| `/tmp/dikidi_full/` (HTML/JSON артефакты Playwright) + `/tmp/dikidi_forms*/` + 59 шт `/tmp/dikidi_*.js` | [[concepts/dikidi-extraction-attempts]] |
| `~/work/food-flow/Wiki/` | Конвенции вики, паттерн микросервисов; см. также `food-flow/decisions/2026-04-11-deep-audit` (учтено в [[decisions/2026-04-25-mvp-scope]]) |

## Корневые документы samaya

| Источник | Покрытие |
|---|---|
| `README.md` | общий обзор, quickstart |
| `.env.example` | список env-переменных проекта |

## docs/
_(пока нет)_

## Миграции БД

| Миграция | Покрытие |
|---|---|
| `database/migrations/001_users.sql` | [[services/user-service]] — таблицы `companies`, `users`, `refresh_tokens` + триггеры updated_at + сид компании Samaya |
| `database/migrations/002_salons.sql` | [[services/salon-service]] — `service_categories`, `services` (с `tech_card_id` ref для Phase 0b), `masters`, `master_services`, `master_schedules` |
| `database/migrations/003_bookings.sql` | [[services/booking-service]] — `bookings` (с EXCLUDE constraint на пересечение интервалов через `btree_gist`), `booking_services` (snapshot), `booking_events_outbox` |
| `database/migrations/004_inventory.sql` | [[services/inventory-service]] — `products`, `warehouses` (сид default), `suppliers`, `supplier_invoices`, `stock_lots` (FIFO), `stock_movements` (с UNIQUE idempotency), `tech_cards` + `tech_card_items` |
| `database/migrations/005_clients.sql` | [[services/client-service]] — `clients` (CITEXT phone unique per company, avatar_color, bonus_balance, флаги is_blocked/is_deleted, trgm-индексы) |

## Конфигурация

| Источник | Покрытие |
|---|---|
| `docker-compose.yml` | оркестрация (postgres + redis + kong; сервисы добавляются по готовности) |
| `kong/kong.yml` | DB-less Kong: CORS + rate-limit; routes пустые, добавляются по мере появления сервисов |
| `database/init/01-create-schemas.sql` | создание схем `users`/`salons`/`bookings`/`clients`/`inventory` + расширения uuid-ossp/pg_trgm/citext |
| `database/init/03-run-migrations.sh` | автоприменение `database/migrations/*.sql` при первом старте контейнера |
