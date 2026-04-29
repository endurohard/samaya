---
type: service
status: stable
last_verified: 2026-04-25
sources:
  - services/booking-service/
  - database/migrations/003_bookings.sql
---

# booking-service

Слоты, записи, lifecycle, outbox-события.

- **Порт**: 3003
- **БД**: PostgreSQL, схема `bookings` (читает также `salons.*` для услуг/мастеров/расписания)
- **Префикс**: `/api/bookings/*` (через Kong на `:8010`)
- **Часовой пояс компании**: env `COMPANY_TZ_OFFSET` (default `+03:00` — Москва).

## Ответственность

- Создание/чтение записей, lifecycle (`pending` → `confirmed` → `completed` | `canceled` | `no_show`).
- Расчёт свободных слотов мастера на дату с учётом расписания и существующих броней.
- **Защита от double-booking** через PostgreSQL exclusion constraint (`btree_gist`) — атомарно на уровне БД, не на уровне приложения.
- **Outbox-pattern** для событий (`booking.created`, `booking.canceled`, `booking.completed`) — пишутся в той же транзакции, что и сам booking. В Phase 0a воркера-публишера нет; в Phase 0b inventory-service подпишется на `booking.completed` для FIFO-списания по техкартам ([[../concepts/inventory-tech-cards]]).
- **Snapshot услуг** в `booking_services` — на момент бронирования цена и длительность фиксируются (services-таблица может потом измениться).

## Endpoints

| Метод | Путь | Кто |
|---|---|---|
| GET | `/api/bookings?from=&to=&master_id=&status=` | auth — журнал (любая роль внутри компании) |
| GET | `/api/bookings/:id` | auth |
| POST | `/api/bookings` | owner/admin/master — создание из админки (статус `confirmed`) |
| PATCH | `/api/bookings/:id` | owner/admin — notes, status |
| POST | `/api/bookings/:id/cancel` | owner/admin/master |
| POST | `/api/bookings/:id/complete` | owner/admin/master |
| POST | `/api/bookings/:id/no-show` | owner/admin |
| GET | `/api/bookings/slots?master_id=&date=&service_ids=A,B&company_id=` | **публично** (для виджета) |
| POST | `/api/bookings/public/create` | **публично** — создание из виджета (статус `pending`) |
| GET | `/health` | внутренний |

## Таблицы (схема `bookings`)

См. `database/migrations/003_bookings.sql`.

- **`bookings`** — id, company_id, master_id (UUID без FK), client_id?/client_phone?/client_name, **starts_at TIMESTAMPTZ**, **ends_at TIMESTAMPTZ**, status (CHECK enum), notes, total_price NUMERIC, source (`admin`/`master`/`public_widget`), canceled_at?/cancel_reason?, completed_at?. CHECK `ends_at > starts_at`. CHECK `client_phone OR client_id` (хотя бы один способ контакта).
- **`booking_services`** — composite PK `(booking_id, service_id)`, snapshot полей `service_name`, `price`, `duration_minutes`. Без FK на `salons.services`.
- **`booking_events_outbox`** — id BIGSERIAL, event_type, booking_id, company_id, payload JSONB, created_at, published_at (NULL = не опубликовано).

**Главное**: exclusion constraint
```sql
EXCLUDE USING gist (
  master_id WITH =,
  tstzrange(starts_at, ends_at) WITH &&
) WHERE (status IN ('pending', 'confirmed'));
```
Один мастер не может иметь две активные брони с пересекающимися интервалами. PostgreSQL отклоняет конфликтующий INSERT с кодом `23P01`. Правило применяется атомарно — никаких race conditions, в отличие от read-then-insert логики.

`btree_gist` extension должно быть установлено: `CREATE EXTENSION IF NOT EXISTS btree_gist;` (есть в миграции).

## Расчёт слотов

`GET /api/bookings/slots?master_id=X&date=2026-04-25&service_ids=A,B`:

1. Загрузить услуги по `service_ids`, проверить принадлежность компании, суммировать `duration_minutes`.
2. Загрузить расписание мастера (`salons.master_schedules`) на эту дату. Если `is_day_off` или нет записи → `items: []`.
3. Получить активные (`pending`/`confirmed`) брони мастера, пересекающие день.
4. Сгенерировать кандидаты с шагом `SLOT_STEP_MINUTES` (default 15) от `start_time` до `end_time - duration` (чтобы вся услуга помещалась).
5. Отфильтровать пересекающиеся с существующими бронями.
6. Вернуть список ISO-таймштампов с offset.

Параметры из env: `COMPANY_TZ_OFFSET` (для конвертации `(work_date, time)` в TIMESTAMPTZ), `SLOT_STEP_MINUTES`.

## Ключевые архитектурные решения

- **Cross-schema READ** из `salons.services`, `salons.masters`, `salons.master_schedules` — booking-service читает напрямую, без HTTP-вызова к salon-service. Допустимо в Phase 0a (single DB, schema-per-service). При разнесении БД — заменить на API-вызовы.
- **Snapshot услуг** в `booking_services` — изменение услуги в `salons.services` не ломает прошлые брони (цена, длительность, название зафиксированы).
- **Outbox** — событие пишется в той же транзакции, что и операция (atomic at-least-once). Воркер-публишер появится в Phase 0b.
- **Exclusion constraint** на уровне БД, а не приложения. Никакого `SELECT ... FOR UPDATE` + ручной проверки — Postgres делает это нативно.
- **TZ через env** (`COMPANY_TZ_OFFSET=+03:00` для samaya). Для SaaS — переедет в `companies.timezone` поле.
- **Public endpoints** не требуют auth, но есть rate-limit на Kong (600/min). Bot-protection и капчи — Phase 1+.
- **Public booking → status `pending`**. Админ должен подтвердить (`PATCH status=confirmed`) или система автоподтвердит (Phase 1). Сейчас фронт-админка показывает `pending` отдельным цветом.

## Связи

- [[user-service]] — JWT issuer.
- [[salon-service]] — источник услуг, мастеров, расписания (cross-schema READ).
- `inventory-service` (Phase 0b) — подпишется на `booking.completed`, спишет расходники по `services.tech_card_id` техкартам.
- `client-service` (Phase 0a iteration) — `bookings.client_id` ссылается на клиента; `client_phone` — денормализация для гостевых записей.

## Известные ограничения Phase 0a

- **Нет валидации в schedule** при ручном создании из админки: админ может поставить запись на 21:00 даже если мастер работает до 20:00. Слоты-эндпоинт это не позволит, но прямой POST позволит. Добавить в Phase 0a iteration.
- **Воркер outbox** не реализован — события только пишутся, не публикуются.
- **TZ один на всю инсталляцию** — `COMPANY_TZ_OFFSET` env. Для multi-tenant SaaS нужно поле `companies.timezone`.
- **Rate-limit** только глобальный Kong (600/min). Per-IP/per-phone лимит против бот-флуда — Phase 1.
- **Нет напоминаний** клиенту (SMS/WhatsApp за день/час до приёма) — Phase 1.
- **Нет переноса** записи (move to another time/master) одной операцией — пока через cancel + create.
