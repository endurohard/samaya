---
type: service
status: stable
last_verified: 2026-04-25
sources:
  - services/salon-service/
  - database/migrations/002_salons.sql
---

# salon-service

Каталог услуг и мастеров салона + расписание мастеров.

- **Порт**: 3002
- **БД**: PostgreSQL, схема `salons`
- **Префикс**: `/api/salons/*` (через Kong на `:8010`)

## Ответственность

- CRUD категорий услуг, услуг (с ценой/длительностью/цветом).
- CRUD мастеров (display_name, specialization, optional `user_id` ref на [[user-service]]).
- Привязка услуг к мастерам (`master_services`) с возможностью кастомной цены/длительности per-master.
- Расписание мастеров (`master_schedules`): на каждый день один интервал `[start_time, end_time)` или `is_day_off=true`.
- **Публичные эндпоинты** под `/api/salons/public/*` — без bearer, для виджета онлайн-записи.

`tech_card_id` в `services` — nullable reference, заполняется в Phase 0b ([[../concepts/inventory-tech-cards]]).

## Endpoints

| Метод | Путь | Кто |
|---|---|---|
| GET | `/api/salons/categories` | auth |
| POST/PATCH/DELETE | `/api/salons/categories[/:id]` | owner/admin |
| GET | `/api/salons/services` | auth |
| POST/PATCH/DELETE | `/api/salons/services[/:id]` | owner/admin |
| GET | `/api/salons/masters` | auth |
| POST/PATCH/DELETE | `/api/salons/masters[/:id]` | owner/admin |
| PUT | `/api/salons/masters/:id/services` | owner/admin (replace assignments) |
| GET | `/api/salons/schedule/:masterId?from=&to=` | auth |
| PUT | `/api/salons/schedule/:masterId` | owner/admin (bulk upsert) |
| GET | `/api/salons/public/services?company_id=...` | публично (виджет) |
| GET | `/api/salons/public/masters?company_id=...` | публично |
| GET | `/api/salons/public/masters/:id/services?company_id=...` | публично |
| GET | `/health` | внутренний |

`company_id` для публичных эндпоинтов: query param или env `DEFAULT_COMPANY_ID`.

DELETE на услугу/мастера — **soft-delete** (`is_active = FALSE`). Жёсткий delete не делаем, чтобы прошлые бронирования сохраняли валидную ссылку с исторической ценой.

## Таблицы (схема `salons`)

См. `database/migrations/002_salons.sql`.

- `service_categories` — id, company_id, name (UNIQUE per company), sort_order.
- `services` — id, company_id, category_id (FK SET NULL), name, price NUMERIC(12,2), duration_minutes (CHECK >0), color, **tech_card_id** (nullable, для Phase 0b), is_active.
- `masters` — id, company_id, **user_id** (nullable, ref на users.users(id) без FK — schema-per-service), display_name, specialization, avatar_url, sort_order, is_active. Partial UNIQUE по `(company_id, user_id)` где `user_id IS NOT NULL`.
- `master_services` — composite PK `(master_id, service_id)`, optional `custom_price`/`custom_duration_minutes`.
- `master_schedules` — id, company_id, master_id, work_date DATE, start_time/end_time (TIME, NULL если `is_day_off=true`), `is_day_off`. UNIQUE `(master_id, work_date)`. CHECK гарантирует, что `is_day_off=true` ⟺ start/end NULL.

## Ключевые архитектурные решения

- **Multi-tenant guard на каждом запросе**: все queries `WHERE company_id = req.auth.company_id`. JWT-claim не сравнивается с body — body может ошибаться или пытаться обмануть. Источник истины — JWT.
- **RBAC**: `requireRole(['owner','admin'])` на всех мутациях. Чтения — любая аутентифицированная роль.
- **Cross-schema FK не используем** (DDD-боундари): `masters.user_id` — UUID без FK на `users.users(id)`. Если когда-то разнесём БД по сервисам, разрыва не будет.
- **Schedule bulk upsert**: PUT `/schedule/:masterId` — `INSERT ... ON CONFLICT (master_id, work_date) DO UPDATE`. Транзакция на весь bulk, валидация мастера в той же транзакции.
- **Master/service assignment** — replace-семантика (PUT), не diff. Транзакция: проверка company_id для services + DELETE all + INSERT new. Защита от cross-tenant: `services WHERE company_id = $1 AND id = ANY(...)`.
- **Public endpoints** не требуют auth, но ограничены `is_active = TRUE`. Будут потребляться [[../services/frontend-service]] и публичным виджетом записи (Phase 0a iteration).
- **Soft-delete** через `is_active = FALSE` сохраняет историческую целостность (будущие бронирования продолжают ссылаться на услугу).

## Связи

- [[user-service]] — JWT issuer; `masters.user_id` ссылается на `users.users(id)`.
- [[frontend-service]] — потребляет `/api/salons/services`, `/api/salons/masters` (см. карточки «Услуги» и «Мастера»).
- `booking-service` (next) — будет потреблять `master_services` (узнать длительность услуги для конкретного мастера) и `master_schedules` (вычислять свободные слоты).
- `inventory-service` (Phase 0b) — `services.tech_card_id` ссылается на BOM в inventory.

## Известные ограничения Phase 0a

- **Один интервал в день** в расписании. Сплит «10–14 / 16–20» не поддерживается (Phase 1: переход на JSONB array of intervals или отдельные строки).
- **Нет копирования расписания** на следующую неделю/месяц одной кнопкой (есть в dikidi). Реализуется в UI поверх bulk-upsert.
- **`user_id` мастера** опциональный — frontend пока создаёт мастеров без user (standalone). Линковка с user — следующая итерация.
- **Нет фронта для категорий** — создание через curl или PATCH `category_id` в форме услуги.
- **Нет UI для расписания** — bulk PUT работает, но grid-эдитор как у dikidi — следующая итерация (это самый объёмный экран).
- **`master_services.custom_price`/`custom_duration_minutes`** — поля в БД есть, но фронт пока их не редактирует.

## Аудит 2026-07-13

См. [[../decisions/2026-07-13-security-correctness-audit]]. ffmpeg-транскод превью: очередь
с лимитом параллелизма + таймаут (M11, защита от OOM при mem_limit 1g); уникальный tmp на
задачу против гонки повторной загрузки (M12); RBAC fail-closed (M8).
