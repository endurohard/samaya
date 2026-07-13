---
type: service
status: stable
last_verified: 2026-04-25
sources:
  - services/client-service/
  - database/migrations/005_clients.sql
---

# client-service

CRM-минимум: справочник клиентов салона + сегментация (постоянные / спящие / пропавшие / новые / без записей / заблокированные / удалённые) на лету по агрегатам из `bookings.bookings`. Phase 0a.

- **Порт**: 3004
- **БД**: схема `clients`, читает также `bookings.bookings` (без FK — schema-per-service)
- **Префикс**: `/api/clients/*`

## Ответственность

- CRUD клиентов (`clients` table): телефон (CITEXT, UNIQUE per company), имя, ДР, пол, email, заметка, цвет аватара, бонусный баланс, флаги `is_blocked`/`is_deleted`.
- **Сегментация на лету** (`GET /api/clients?segment=...`): через JOIN с bookings, без отдельной materialized view. Сегмент пересчитывается на каждом запросе из агрегатов CTE.
- **Счётчики сегментов** (`GET /api/clients/segments`): для сайдбара категорий.
- **Поиск** по `full_name`/`phone` через trigram индексы (`gin_trgm_ops`), ILIKE `%q%`.
- **Soft-delete** (`DELETE` → `is_deleted=TRUE`) и `POST /:id/restore`.
- Источники клиентов: `admin` (вручную), `public_widget` (создаётся booking-service'ом при публичной записи), `import`, `master`. На MVP `public_widget`-связки пишет booking-service в `bookings.bookings.client_phone`; client-service подтягивает их в сегментацию через нормализованный phone.

## Связь с другими сервисами

- **booking-service**: основной источник истории визитов. Связь по `(company_id, client_id)` (если booking создан с известным клиентом) **или** по `(company_id, client_phone)` для записей без `client_id` (публичные брони, ручной ввод). Без FK — schema-per-service.
- **user-service**: проверяет JWT (HS256, общий `JWT_SECRET`).
- **inventory-service / salon-service**: не используются client-service'ом, но клиент может быть «обогащён» в UI данными по последнему мастеру — это решает frontend.

## Сегментация

Параметризовано env-переменными (см. `config.ts`):
- `regular`: visits_in_regular_window ≥ `CLIENT_REGULAR_VISITS` (2 по умолчанию) за последние `CLIENT_REGULAR_DAYS` (90 дней).
- `sleeping`: last_visit_at < NOW() − `CLIENT_SLEEPING_DAYS` (90 дней) и не подходит под `regular`.
- `missing`: last_visit_at < NOW() − `CLIENT_MISSING_DAYS` (180 дней).
- `never`: total_visits = 0 (и не «новый»).
- `new`: created_at ≥ NOW() − `CLIENT_NEW_PERIOD_DAYS` (7 дней) и без визитов.
- `blocked`: `is_blocked=TRUE`.
- `deleted`: `is_deleted=TRUE` (исключается из всех остальных по умолчанию).

В `clients.service.ts` сегмент считается одним SQL-выражением `SEGMENT_EXPR`, переиспользуемым в `WHERE` фильтрации, в `SELECT` (для отдачи в API) и в `GROUP BY` для счётчиков.

## API

| Method | Path | Описание |
|---|---|---|
| GET | `/api/clients?segment=&search=&limit=&offset=` | Список клиентов с агрегатами и сегментом |
| GET | `/api/clients/segments` | `{ all, regular, sleeping, missing, never, new, blocked, deleted }` |
| GET | `/api/clients/:id` | Один клиент с агрегатами |
| POST | `/api/clients` | Создать (admin/master) |
| PUT | `/api/clients/:id` | Обновить (admin/master), включая `is_blocked` |
| DELETE | `/api/clients/:id` | Soft-delete (admin) |
| POST | `/api/clients/:id/restore` | Восстановить (admin) |

## Известные ограничения / TODO

- **Связь по phone хрупкая**: если клиент сменит телефон, агрегаты по старым bookings без `client_id` отвалятся. План: при создании клиента из booking-service подставлять `client_id` по уже существующему телефону, либо иметь миграционный скрипт «склейки».
- **Бонусы**: `bonus_balance` двигается при оформлении продажи (booking-service `/:id/complete`),
  движения журналируются в `clients.bonus_operations` (миграция 028) — см. аудит
  [[../decisions/2026-07-13-security-correctness-audit]] (C1).
- **Бонусная программа / RFM / Рассылки**: подразделы UI заглушены (`P1`).
- **Импорт CSV/Excel**: пока только экспорт текущей страницы на клиенте; серверный импорт — Phase 1.
- **CLIENT_REGULAR_DAYS и CLIENT_SLEEPING_DAYS** сейчас одинаковые (90); это сохраняет совместимость с DIKIDI-логикой «постоянные = 2+ за 3 мес ⊆ не спящие». Если бизнес попросит, разнесём.

## Аудит 2026-07-13

См. [[../decisions/2026-07-13-security-correctness-audit]]. Единое определение
визита/выручки (`status='completed'`, нетто `total_price − discount_amount`) в
списке/карточке/экспорте/портале (M6); привязка записи не к заблокированной карточке,
реактивация удалённой (M7); RBAC fail-closed (M8); бонусы двигают `bonus_balance` (C1).
