---
type: service
status: stable
last_verified: 2026-09-12
sources:
  - services/salon-service/
  - database/migrations/002_salons.sql
  - database/migrations/051_service_catalogs.sql
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
| GET/POST | `/api/salons/catalogs` | services.view / services.manage |
| GET/PATCH/DELETE | `/api/salons/catalogs/:id` | services.view / services.manage |
| PUT/POST | `/api/salons/catalogs/:id/services` | services.manage (PUT — заменить состав, POST — дописать) |
| DELETE | `/api/salons/catalogs/:id/services/:serviceId` | services.manage |
| POST | `/api/salons/catalogs/:id/regenerate` | services.manage (новый токен ссылки) |
| GET | `/api/salons/public/site-url` | публично — `{ site_url }` из `FRONTEND_URL`, для ссылок из админки |
| GET | `/api/salons/public/site/c/:token[/:key]` | публично — страница каталога по ссылке (nginx: `/c/...`) |
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

## Каталоги услуг по ссылке (2026-09-12)

Подборка услуг, которую администратор собирает вручную и отправляет клиенту одной ссылкой
`/c/<token>`. Отличие от сайта `/services`: туда попадают только `show_in_menu`, а в каталог —
любая активная услуга компании, поэтому страница услуги живёт внутри каталога
(`/c/<token>/<slug|id>`), а не на общем `/services/<slug>`.

- Таблицы `salons.service_catalogs` (name, description, `token` UNIQUE, `is_active`, `views`) и
  `salons.service_catalog_items` (PK `(catalog_id, service_id)`, `sort_order` = порядок добавления).
  Миграция `database/migrations/051_service_catalogs.sql`.
- Токен — 12 случайных байт в base64url, 16 символов (`src/token.ts`). Публичный роут сначала
  проверяет его регуляркой `CATALOG_TOKEN_RE` и только потом идёт в БД.
- Состав пишется через `INSERT ... SELECT ... JOIN salons.services s ON s.company_id = $company`
  (`routes/catalogs.ts`), так что чужие `service_id` молча отбрасываются — без отдельной проверки.
- «Сменить ссылку» (`/regenerate`) выдаёт новый токен и обнуляет `views`; выключенный `is_active`
  и удалённый каталог отдают 404 «Каталог не найден». Страницы помечены `X-Robots-Tag: noindex` —
  это персональные ссылки, не для индекса.
- Счётчик открытий инкрементится best-effort (`void pool.query(...)`), ответ не ждёт.
- Тесты: `__tests__/token.test.ts`, `__tests__/site-catalog.test.ts` (SSR с замоканным pool).

## Ключевые архитектурные решения

- **Multi-tenant guard на каждом запросе**: все queries `WHERE company_id = req.auth.company_id`. JWT-claim не сравнивается с body — body может ошибаться или пытаться обмануть. Источник истины — JWT.
- **RBAC**: мутации услуг, групп и каталогов — по праву `services.manage` (`requirePermission`, гейт в `index.ts`), а не по роли: мастер с выданным правом может править каталог. Мастера/должности/расписание пока по-старому — `requireRole(['owner','admin'])`. Чтения — любая аутентифицированная роль.
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
