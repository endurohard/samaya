# Wiki Log

Append-only хронология. Новые записи снизу.

## [2026-04-25] bootstrap | Wiki initialized
- Создан скелет вики по паттерну Karpathy LLM Wiki (повторяет структуру из `~/work/food-flow/Wiki`).
- Файлы: `AGENTS.md`, `index.md`, `log.md`, `sources.md` + пустые `services/`, `concepts/`, `decisions/`.
- Конфиг Obsidian (`.obsidian/`) скопирован из food-flow.
- Источники: пока нет — проект samaya только инициализирован (только `.git`).
- Следующий шаг: первый ingest, как только в репо появится код/миграции/docs.

## [2026-04-25] redesign | Журнал записей — календарный grid в стиле dikidi
По запросу владельца «посмотри функционал и визуализацию в dikidi» — переделан главный экран админки. Раньше был плоский список записей; теперь — **календарный grid с колонками-мастерами и временной осью**, как у dikidi screenshot 1.

В шапке журнала добавлен переключатель `Календарь / Список` (pill-toggle, выбор сохраняется в localStorage). По умолчанию — календарь.

Календарный layout:
- Header: ось мастеров (avatar + имя), горизонтальный grid (60px time + N мастеров)
- Body: левая колонка — часовая ось (09:00–22:00, hardcoded для MVP), потом колонки мастеров с position:relative
- Каждая бронь — `<div class="cal-booking">` с absolute-позицией: `top = (start - 9:00) * 60px`, `height = duration_minutes * 1px`. 60px = 1 час.
- Цвет блока — из первой услуги бронирования (если у услуги есть `color`), иначе генерируется из service_id хеша. background = `color + '22'` (20% opacity), border-left = full color.
- Pending записи — dashed border + бейдж `NEW` сверху-справа.
- Completed — opacity 0.55.
- Каждый час — линия в grid; каждые 30 мин — половинная линия с opacity 0.4.
- Click по броне → alert со всеми деталями (имя, телефон, мастер, услуги, время, сумма, статус, заметки).
- Hover → нативный browser tooltip с тем же текстом.

Список (старый view) переименован в `Список`, скрыт по умолчанию, остаётся для bulk-действий cancel/complete.

Изменения:
- `index.html`: добавлен `<div class="cal-toggle">` и `<div id="journalCalendar" class="cal-container">`. Существующий `journalList` получил `hidden` атрибут.
- `app.js`: новые константы `CAL_START_HOUR=9`, `CAL_END_HOUR=22`, `CAL_PX_PER_MIN=1`. Новые функции `applyJournalMode()`, `renderCalendar()`. State `journalMode` персистится в localStorage.
- `style.css`: ~110 строк под `.cal-toggle`, `.cal-grid`, `.cal-master-head`, `.cal-time-axis`, `.cal-hour-label`, `.cal-master-col`, `.cal-hour-line`, `.cal-half-line`, `.cal-booking{,.pending,.done}`, `.cal-booking-badge`, адаптив до 800px (скрывает service-text).

E2E: рендерится корректно для текущих данных (1 мастер «Магомедова Наида», брони 25-29 апреля). Цветные блоки на правильных позициях по времени, бейдж NEW на pending-бронях.

## [2026-04-25] scaffold | inventory-service (Phase 0b) + автосписание + UI склада
**Phase 0b закрыт.** Реализована главная бизнес-фича владельца — поступление расходников и автосписание со склада по техкартам услуг. См. [[services/inventory-service]].

Стек тот же (Node 20 + TS commonjs + Express + pg + jose + zod + pino). Структура `src/routes/{products,suppliers,warehouses,receipts,stock,tech-cards}.ts` + `src/worker.ts`.

Миграция `database/migrations/004_inventory.sql` (схема `inventory`):
- 8 таблиц: products, warehouses (сид «Основной склад» детерминированный UUID), suppliers, supplier_invoices, stock_lots, stock_movements, tech_cards, tech_card_items.
- FIFO/FEFO партиальные индексы на `qty_remaining > 0`.
- **Главный constraint — UNIQUE `(company_id, source_type, source_id, product_id, lot_id) WHERE source_* IS NOT NULL`** на stock_movements: idempotency списания при retry событий.
- Partial UNIQUE на `tech_cards (is_active=TRUE)` per (company, service) — только одна активная версия.
- Partial UNIQUE на `warehouses (is_default=TRUE)` per company.
- Триггеры updated_at.

Worker автосписания (`src/worker.ts`) — фоновый поллинг каждые 10s в том же процессе:
1. `SELECT FOR UPDATE SKIP LOCKED` пачку неопубликованных `booking.completed` из `bookings.booking_events_outbox`.
2. Для каждого события: загрузить `booking_services`, для каждой услуги найти активную техкарту, FIFO-списать `tech_card_items`.
3. Атомарный декремент `UPDATE stock_lots SET qty_remaining = qty_remaining - X WHERE id = $1 AND qty_remaining >= X`.
4. INSERT `stock_movements` (тип consumption, source=booking). 23505 ловится как idempotency-retry — откат декремента, продолжение.
5. Если не хватило — virtual movement с notes='stock_insufficient' (компромиссный режим из ADR-002).
6. `UPDATE outbox SET published_at = NOW()` в той же транзакции.

E2E через `localhost:8010` — полный цикл проверен:
1. POST products → «Гель-проводник X» (мл) + «Простыня одноразовая» (шт)
2. POST suppliers → «ООО Чистовье»
3. POST receipts → 1000 мл @50₽ + 200 шт @30₽ → стоимость накладной 56000 ₽
4. GET products → остаток 1000 мл / 200 шт, средняя цена корректна
5. PUT tech-cards для «ЛЛ живота»: 50 мл геля + 1 простыня на услугу
6. POST bookings + complete booking
7. Wait 11s → worker обработал событие
8. GET products → **остаток 950 мл / 199 шт** ✓
9. GET stock/movements → 4 строки: 2 receipts + 2 consumptions с источником `booking`
10. Outbox event помечен `PUBLISHED`, последующие retry дают 23505 (no-op)

Подключение:
- Kong route `/api/inventory` → `inventory-service:3005` (reload kong)
- Контейнер `samaya-inventory-service` в compose, env: CONSUME_WORKER_ENABLED=true, INTERVAL=10000ms, BATCH=20.
- DEFAULT_WAREHOUSE_ID hardcoded в env как `11111111-…111` (детерминированный из миграции).

Frontend: новый view «Склад» (sidebar item теперь активный):
- Карточка «Расходники»: список с остатком (зелёный/жёлтый/красный по min_stock), counter, кнопки `+ Товар` и `+ Поступление`. Inline-форма поступления с repeated rows (продукт/кол-во/цена) и dropdown'ом поставщика.
- Карточка «Техкарты услуг»: список услуг с активной техкартой (или меткой «нет техкарты»), badges позиций. Кнопка `+ Техкарта` или `Изменить` per service → форма с repeated rows (продукт/qty_per_service).
- Карточка «Журнал движений»: последние 50 операций, цвет qty (зелёный приход / красный расход), source (запись/накладная/ручная).
- 50 строк CSS в style.css: stock-ok/low/empty, recipe-row grid, mov-in/out цвета.

Контейнер frontend пересобран. **Все 8 контейнеров healthy**: postgres, redis, kong, user-service, salon-service, booking-service, inventory-service, frontend.

**Закрыты обе фазы Phase 0a + 0b.** Готов MVP-каркас полнофункциональной платформы для бьюти-салона: auth + журнал + услуги + мастера + расписание + публичный виджет онлайн-записи + склад + автосписание по техкартам.

## [2026-04-25] scaffold | UI расписания мастеров (admin)
По запросу владельца «продолжаем поэтапно» — добавлена админская страница «График работы». Закрывает последний UI-кусок Phase 0a (раньше расписание выставлялось только через curl). Backend `salon-service` уже умел bulk-upsert через `PUT /api/salons/schedule/:masterId`.

В сайдбаре пункт «График работы» больше не disabled — активный view.

UI: master dropdown + date range (от-до, default = сегодня + 13 дней), список строк по дням. Каждая строка:
- дата (DD.MM (Дд)) — выходные дни (Сб/Вс) подсвечены красным фоном
- чекбокс «Выходной» (отключает поля времени)
- `<input type="time">` start — `<input type="time">` end
- метка справа: `✓` если сохранено, `●` (пульсирующий) если есть несохранённые изменения

Кнопки в шапке:
- `Шаблон 10–20` — заполняет 10:00-20:00 во всех ПУСТЫХ дняхне трогая уже заполненные)
- `Сохранить (N)` — N изменений, disabled если нет dirty-строк

Логика:
1. Load: `GET /api/salons/schedule/:masterId?from=&to=` → строит сетку всех дней в диапазоне (`buildScheduleItems`), отсутствующие в БД помечаются как пустые/dashed.
2. Edit: каждое изменение полей помечает `dirty=true`, ререндерит строку с маркером.
3. Save: фильтрует только dirty-строки + валидные (is_day_off OR start+end), отправляет `PUT items` bulk. Сервер делает `INSERT ... ON CONFLICT DO UPDATE` в одной транзакции.

После save — перезагружаем расписание из сервера, очищаем dirty.

Стили: `.sch-row` grid (110px дата + 130px чекбокс + 1fr time + 24px arrow + 1fr time + 24px mark), `.sch-row.weekend` (красный фон), `.sch-row.is-off` (полупрозрачный), `.sch-row.empty` (dashed border, серый фон). Адаптив до 700px — переход на 2 колонки.

Контейнер frontend пересобран. Все 7 контейнеров healthy. Phase 0a admin-функционал закрыт полностью: auth + журнал + услуги + мастера + график работы.

## [2026-04-25] scaffold | публичный виджет онлайн-записи
По адресу `http://localhost:3010/widget.html` поднят публичный виджет для клиентов салона (без auth). См. секцию «Публичный виджет» в [[services/frontend-service]].

Дизайн: одна страница, 5 секций, появляются последовательно по мере выбора. Sticky summary-карточка с тёмным градиентом снизу. Адаптив до 480px. Полностью переиспользует публичные эндпоинты [[services/salon-service]] и [[services/booking-service]].

Файлы:
- `services/frontend/public/widget.html` — структура, 5 шагов + summary + success.
- `services/frontend/public/widget.js` — state machine, обработка кликов, обновление summary, submit с обработкой `SLOT_TAKEN` (перезагрузка слотов).
- `services/frontend/public/widget.css` — отдельный стиль с префиксом `--w-*`, чтобы не конфликтовать с админским style.css.

API-флоу клиента (всё public, без bearer):
1. `GET /api/salons/public/services` → список услуг.
2. `GET /api/salons/public/masters` → список мастеров.
3. `GET /api/bookings/slots?master_id=&date=&service_ids=A,B` → доступные временные слоты (15 мин шаг).
4. `POST /api/bookings/public/create` → создание записи в статусе `pending`, source=`public_widget`.

E2E через `localhost:3010` (nginx → Kong → backends):
- /api/salons/public/services → 1 услуга
- /api/salons/public/masters → 1 мастер
- /api/bookings/slots на 28.04 → 33 слота (пустой день, 10:00-20:00, 120 мин услуга, 15 мин шаг — корректно)
- POST /api/bookings/public/create → 201, status `pending`.

Контейнер frontend пересобран. Все 7 контейнеров healthy.

## [2026-04-25] scaffold | booking-service (Phase 0a, сервис №3) + UI журнала
Реализован третий сервис: расчёт слотов, создание/отмена/завершение записей, outbox-события. См. [[services/booking-service]].

Стек тот же (Node 20 + TS commonjs + Express + pg + jose + zod + pino + helmet). Структура `src/routes/{bookings,slots,public}.ts` + общий `services.ts` (loader снапшотов услуг + assertMaster + toCompanyTime).

Миграция `database/migrations/003_bookings.sql` (схема `bookings`):
- `bookings` (UUID PK, master_id/client_* без FK, starts_at/ends_at TIMESTAMPTZ, status enum, total_price snapshot, source `admin|master|public_widget`, canceled_at/completed_at).
- **EXCLUDE USING gist** на пересечение `tstzrange(starts_at, ends_at)` per master — БД-уровневая защита от double-booking, atomic.
- `booking_services` (snapshot id+name+price+duration на момент создания).
- `booking_events_outbox` (event_type, booking_id, payload JSONB, published_at).
- `btree_gist` extension добавлена.

Применена `psql -f /migrations/003_bookings.sql` на работающую БД.

Архитектурные решения:
- **Cross-schema READ** из `salons.*` (услуги, мастера, расписание). В Phase 0a допустимо (single DB).
- **Snapshot услуг** в `booking_services` — изменение услуги в salon-service не ломает прошлые брони.
- **Outbox** в той же транзакции — at-least-once. Воркер-публишер — Phase 0b.
- **TZ через env** `COMPANY_TZ_OFFSET=+03:00` (Москва) для конвертации `(work_date, time)` → TIMESTAMPTZ.
- **Public endpoints** без auth: `GET /slots`, `POST /public/create` (статус pending для модерации).

Подключение:
- Kong route `/api/bookings` → `booking-service:3003` (reload Kong).
- Контейнер `samaya-booking-service` в compose, healthcheck на `/health`.

E2E через `localhost:8010`:
- 33 свободных слота на 25.04 (расписание 10:00-20:00, услуга 120 мин, шаг 15 мин — корректно).
- POST `/api/bookings` на 11:00 → 201, статус `confirmed`. После — 21 свободный слот (12 заблокированы из-за пересечения с 11:00-13:00 — корректно по математике [10:00-13:00) шаг 15 мин = 12 слотов).
- Дабл-букинг на 11:30 → **409 SLOT_TAKEN** (PostgreSQL exclusion code 23P01).
- Public endpoint `POST /api/bookings/public/create` без bearer → 201, статус `pending`, source `public_widget`.
- GET `/api/bookings?from=&to=` возвращает обе записи с услугами через json_agg.
- POST `/cancel` — отменяет, status='canceled', canceled_at + cancel_reason.
- После cancel слоты снова доступны (canceled не блокирует exclusion constraint — partial WHERE).
- Outbox: 3 события (`booking.created` x2 + `booking.canceled` x1) в `booking_events_outbox`, payload JSONB.

Frontend:
- В сайдбаре пункт «Журнал записей» больше не disabled — это активный view.
- Новый view `journal` с date-picker (default = сегодня), счётчиком, кнопкой `+ Запись`.
- Список записей: время (HH:MM – HH:MM из ISO с конвертацией в браузерный TZ), клиент + телефон, мастер + список услуг через запятую, статус-pill (5 цветов), цена, кнопки `Отменить`/`Завершить` для активных.
- Форма создания: master dropdown, datetime-local picker, телефон, имя, multi-checkbox для услуг (с длительностью и ценой), notes. Submit отправляет с offset `+03:00`. Ошибка SLOT_TAKEN показывается в alert.
- 4 новых статус-класса: `pill-warn` (pending), `pill-ok` (confirmed), `pill-mute` (completed/canceled), `pill-danger` (no_show).

Контейнер frontend пересобран. Все 7 контейнеров healthy.

## [2026-04-25] redesign | frontend visual — dikidi-style layout
По запросу владельца («посмотри как у нас в dikidi визуал тоже надо сделать нормальный») — полная переработка визуала фронта под образ dikidi.

Новая структура:
- **Тёмный сайдбар слева** (240px, sticky 100vh) с брендом, навигацией по модулям и user-mini внизу. SVG-иконки (heroicons-style outline). Активный пункт подсвечен. Disabled-пункты помечены pill'ом «ожидает X-service».
- **Светлая рабочая зона справа** (`#f4f5f8` фон, `#fff` карточки с тонкой тенью).
- **Top bar** с заголовком текущего view, бейджем «Тариф: PRO» и кнопкой `API лог` справа.
- **Views** переключаются по клику на пункт сайдбара: `profile` (auth-карточка → user-карточка с claims), `services`, `masters`, `placeholder` (для disabled-пунктов).
- **API-лог** перенесён в drawer внизу-справа, открывается по кнопке. Не загромождает интерфейс.
- **Цветовая схема**: акцент `#3b82f6` (blue), success `#22c55e`, warn `#f59e0b`, danger `#dc2626`, тёмный сайдбар `#14161c`.
- **Add-блоки** услуг/мастеров переехали из `<details>`-аккордеона на кнопку `+ Добавить` в шапке секции, разворачиваются как panel ниже.
- В сайдбаре отображены **все 11 модулей dikidi**: Профиль / Журнал / График / Клиенты / Услуги / Мастера / Продвижение / Сообщения / Зарплата / Продажи / Финансы / Склад / Настройки. Реализованы только Профиль/Услуги/Мастера, остальные disabled с pill-меткой.
- **`user-mini` в подвале сайдбара** — аватар + имя + роль, при логине; статус backend (точка + надпись) под ним.

Адаптив: при ≤900px сайдбар переезжает наверх (1-колоночный layout), формы становятся одноколоночными.

Backend и API не менялись. Контейнер frontend пересобран.

Все 6 контейнеров healthy.

## [2026-04-25] scaffold | salon-service (Phase 0a, сервис №2) + UI услуг/мастеров
Реализован второй сервис: категории, услуги, мастера, привязки и расписание. См. [[services/salon-service]].

Стек тот же, что в user-service (Node 20 + TS commonjs + Express + pg + jose + zod + pino + helmet). Структура `src/routes/{categories,services,masters,schedule,public}.ts`, общие middleware (`authenticate`, `requireRole`, `errorHandler`).

Миграция `database/migrations/002_salons.sql` (схема `salons`):
- `service_categories` (UNIQUE per company),
- `services` (price NUMERIC, duration_minutes, color, **tech_card_id** nullable для Phase 0b, is_active soft-delete),
- `masters` (user_id nullable, partial UNIQUE per company где user_id IS NOT NULL),
- `master_services` (composite PK + optional custom price/duration per-master),
- `master_schedules` (1 интервал в день, CHECK гарантирует консистентность is_day_off ⟺ start/end NULL).

Применена на работающую БД через `psql -f /migrations/002_salons.sql` (init-script авто-применяется только при первой инициализации тома).

Архитектурные решения:
- **company_id из JWT, не из body** — multi-tenant guard на каждом запросе.
- **RBAC** через `requireRole(['owner','admin'])` для мутаций. Чтения — любая аутентифицированная роль.
- **Soft-delete** через `is_active = FALSE` (бронирования сохраняют ссылку).
- **Cross-schema FK не используем**: `masters.user_id` без FK на `users.users` — DDD-границы между сервисами.
- **Schedule bulk upsert** одной транзакцией с проверкой мастера в этой же транзакции, `INSERT ... ON CONFLICT (master_id, work_date) DO UPDATE`.
- **Master/service assignment** — replace-семантика PUT, проверка `company_id` всех service_ids в одной транзакции (защита от cross-tenant манипуляций).

Подключение в инфру:
- В `kong/kong.yml` добавлен сервис `salon-service` с маршрутом `/api/salons` (`strip_path: false`). Kong перезагружен (`docker compose restart kong`), `/services` и `/routes` теперь содержат `user-service` + `salon-service`.
- В `docker-compose.yml` добавлен контейнер `samaya-salon-service` (3002 expose only, healthcheck на `/health`).

E2E через `localhost:8010`:
- Owner → создал категорию `Косметология`, услугу `ЛЛ живота` (450 000 ₽, 120 мин, color `#a78bfa`).
- Зарегистрирован user-master `master.naida@samaya.test`, создан master-профиль «Магомедова Наида» с user_id привязкой.
- Услуга назначена мастеру (PUT `/masters/:id/services`).
- Расписание: 3 рабочих дня (10:00–20:00) + 1 выходной — все 4 строки на месте при чтении.
- Public endpoints `/api/salons/public/services` и `/.../masters` без bearer — отдают только `is_active=true`.
- RBAC: client получает 403 на POST `/services`, owner проходит — корректно.

Frontend (`services/frontend/`):
- `index.html`: добавлены 2 секции `data-card` — «Услуги» и «Мастера», скрыты пока user не залогинен. Каждая содержит `<details>` с inline-формой создания.
- `app.js`: после успешного auth подгружает `/api/salons/services` и `/api/salons/masters`, рендерит списки. Услуги — цветная точка + название + категория + price · duration. Мастера — мини-аватар + имя + специализация + бейджи назначенных услуг (резолвятся по svcMap из cachedServices). Inline-формы скрываются для не-owner/admin (`applyRoleVisibility(role)`).
- `style.css`: новые классы `.data-card`, `.data-list`, `.row-item`, `.dot-color`, `.user-avatar.small`, `.badge`, `.empty`, `.add-block`, `.form-grid`.

Контейнер frontend пересобран (`docker compose build frontend-service`).

Все 6 контейнеров healthy: postgres + redis + kong + user-service + salon-service + frontend.

Открытые ограничения зафиксированы в [[services/salon-service#Известные ограничения Phase 0a]] (1 интервал в день, нет UI для расписания и категорий, custom_price/duration в БД но не в UI, мастера пока без user-привязки на фронте).

Следующие шаги (порядок предлагается обсудить): UI для редактирования расписания мастеров (grid как в dikidi) → `booking-service` (слоты + создание/отмена записей) → `client-service` или сразу Phase 0b inventory.

## [2026-04-25] scaffold | frontend-service (admin SPA, минимум)
Поднят простой admin-UI для визуализации auth-флоу и статуса инфры. См. [[services/frontend-service]].

Стек: nginx:1.27-alpine + vanilla HTML/JS/CSS. Без React/Vite — toolchain не тащим, переезд на нормальный SPA будет в Phase 0a iteration или Phase 1.

Что в карточках:
- Header со статусом backend (зелёная точка = OK), пробинг каждые 10s через `GET /api/auth/me` (без bearer → 401 = сервис жив).
- Auth-card с табами Войти/Регистрация, поле принимает email **или** телефон (детект по `@`). После логина — аватар (генерируется по user_id), имя, claims JWT (sub/company_id/role/exp), кнопки `Обновить токены` (полный refresh-флоу с ротацией) и `Выйти`.
- 4 placeholder-карточки модулей (Журнал/График/Клиенты/Склад) с pill-статусом «ожидает X-service» — заполнятся по мере подключения.
- API-лог внизу: live-журнал HTTP-запросов с timestamp, методом, путём, статусом.

nginx-конфиг: `location /api/ → proxy_pass http://kong:8000` (фронт обращается same-origin, без CORS-проблем). SPA fallback `try_files $uri $uri/ /index.html`. `Cache-Control: no-cache` на html/css/js (dev).

Хост-порт: `FRONTEND_PORT=3010` (3000 был занят на хосте). Открыть `http://localhost:3010`.

`localStorage` хранит `access_token`, `refresh_token`, `user`. Cookie/HttpOnly — позже (нужен HTTPS + CSRF).

Контейнер `samaya-frontend` подключён в `docker-compose.yml` (`depends_on: kong`).

Проверено:
- `GET /` → 200, отдаёт `index.html` (5043 bytes).
- `GET /api/auth/me` через nginx → 401 `missing bearer token` (полный путь nginx → kong → user-service → postgres работает).
- `POST /api/auth/register` через nginx → 201 + JWT (создан второй юзер `admin@samaya.test`).

Все 5 контейнеров healthy: postgres, redis, kong, user-service, frontend.

## [2026-04-25] scaffold | user-service (Phase 0a, сервис №1)
Реализован первый сервис: auth + пользователи + компании. См. [[services/user-service]].

Стек: Node 20 + TypeScript (CommonJS) + Express + pg + bcryptjs + jose + zod + pino + helmet + vitest. Dockerfile multi-stage (deps → builder → runtime), USER node, tini как ENTRYPOINT.

Миграция `database/migrations/001_users.sql` (схема `users`):
- `companies` (UUID PK, CITEXT slug UNIQUE, сид `00000000-…001 = samaya`),
- `users` (UUID, company_id FK, email/phone (CITEXT/TEXT, partial unique по company), password_hash, role CHECK in {owner,admin,master,client}, is_active),
- `refresh_tokens` (UUID, token_hash UNIQUE — SHA256 hex; expires_at, revoked_at, ip, user_agent),
- триггеры updated_at.

Реализованные правила корректности:
- **JWT secret fail-hard в production** (`src/config.ts`): дефолт из `.env.example` падает на старте.
- **Refresh rotation с защитой от replay**: `SELECT ... FOR UPDATE OF rt` + revoke в одной транзакции. Подтверждено E2E — повторное использование токена → 401 `REFRESH_REVOKED`.
- **Multi-tenant с первого дня**: `company_id` в JWT-claims, во всех таблицах, partial unique индексы по `(company_id, email)` и `(company_id, phone)`.
- **`SET search_path TO users, public`** на connect (public для citext/uuid-ossp).
- **`trust proxy = true`** (за Kong'ом).

Подключение в инфру:
- В `kong/kong.yml` добавлен сервис `user-service` с маршрутом `/api/auth` (strip_path: false).
- В `docker-compose.yml` добавлен контейнер `samaya-user-service` (порт 3001 expose only) с healthcheck на `/health`.
- В `.env`/`.env.example` `DEFAULT_COMPANY_ID` сменён с `1` на UUID `00000000-0000-0000-0000-000000000001`.

Ошибка по пути и фикс: первая попытка миграции упала — `type "citext" does not exist`. Причина: `SET search_path TO users` (без `public`) делал extension `citext` невидимым. Исправлено `SET search_path TO users, public`.

E2E-проверка через Kong (`localhost:8010`):
- `POST /api/auth/register` → 201 + tokens
- `POST /api/auth/login` → 200 + tokens
- `GET /api/auth/me` (bearer) → 200 + claims (sub, company_id, role)
- `GET /api/auth/me` без токена → 401 `missing bearer token`
- `POST /api/auth/refresh` → 200 + новые токены
- replay того же refresh → 401 `REFRESH_REVOKED`
- неверный пароль → 401 `INVALID_CREDENTIALS`
- дубль регистрации → 409 `USER_EXISTS`

Все 4 контейнера (postgres + redis + kong + user-service) `healthy`.

Открытые ограничения Phase 0 (зафиксированы в [[services/user-service#Известные ограничения Phase 0]]): нет recovery, lockout, audit-лога; `/register` пока публичный.

Следующий сервис: `salon-service` (компания, услуги, мастера, расписание).

## [2026-04-25] verify | Phase 0a infra — стартует и healthy
`docker compose up -d postgres redis kong` — все три контейнера healthy.
- Postgres: схемы `users`/`salons`/`bookings`/`clients`/`inventory` созданы init-скриптом, расширения uuid-ossp/pg_trgm/citext подгружены.
- Redis: `PING → PONG`.
- Kong: admin `/status` отвечает; proxy возвращает 404 на `/` (ожидаемо — `routes: []`).

Правки во время bring-up:
- Убран `version: '3.9'` из `docker-compose.yml` (obsolete).
- Снят `ports: 5432:5432` у postgres — на хосте 5432 занят food-flow Postgres. Сервисы samaya достучатся через docker network `postgres:5432`. Для доступа psql из хоста — `docker-compose.override.yml` с `ports: ["5433:5432"]` (не коммитить).
- Хост-порты Kong: `8000/8001` → **`8010/8011`** (food-flow Kong держит 8000/8001). Записано в `.env.example`.

## [2026-04-25] scaffold | Phase 0a — infra layer
По одобрению владельца ("ок") принят набор дефолтов и создан инфра-скелет проекта:
- `docker-compose.yml` — postgres-16-alpine + redis-7-alpine + kong:3.5 (DB-less). Сервисы (user/salon/booking/client/frontend, inventory) добавляются по мере готовности.
- `.env.example` — переменные (POSTGRES_*, JWT_SECRET, KONG_*, DEFAULT_COMPANY_*); `.env` в `.gitignore`.
- `kong/kong.yml` — пустые services/routes + plugins CORS и rate-limit (600/min).
- `database/init/01-create-schemas.sql` — схемы `users`, `salons`, `bookings`, `clients`, `inventory` + extensions uuid-ossp/pg_trgm/citext.
- `database/init/03-run-migrations.sh` — авто-применение `*.sql` из `/migrations/` при первом старте.
- `README.md` — стартовая точка, quickstart, ссылки в Wiki.
- `.gitignore` — node_modules, .env, .DS_Store, `.local/`, `Wiki/.obsidian/workspace*.json`.

Дефолты по открытым вопросам ADR-001/ADR-002:
- single-tenant (но `company_id` везде с первого дня — multi-tenant-ready);
- Phase 0 двухэтапная (0a без inventory → 0b с inventory);
- один склад в 0b;
- при недостаче расходника — списываем сколько есть + ставим флаг (не блокируем complete);
- WhatsApp/нотификации — Phase 1+;
- деплой — локальный docker-compose; язык UI — только русский в Phase 0.

Следующий шаг (после go от владельца): scaffold `services/user-service` (auth + JWT с fail-hard guard, миграция `001_users.sql`).

## [2026-04-25] requirement | inventory + tech-cards must be in MVP
Владелец явно потребовал учёт расходников и автосписание по техкартам уже в Phase 0:
> "нужно настроить поступление расходников на склад и добавлять расход к услугам, чтоб сверять остатки"

Создан концепт [[concepts/inventory-tech-cards]] (модель: products, stock_lots FIFO, stock_movements, tech_cards с версионированием, warehouses, supplier_invoices, inventory_counts; правила корректности — атомарное списание с guard, outbox для `booking.completed`, идемпотентность, FEFO для срока годности).

Принят ADR-002 [[decisions/2026-04-25-inventory-in-mvp]]: добавляем `inventory-service` (порт 3005) в Phase 0; в `salon-service.services` появляется `tech_card_id`; в `booking-service` outbox-таблица и публикация `booking.completed` с первого дня.

Предложена альтернатива — двухэтапная Phase 0 (0a без inventory, 0b с ним) ради более раннего демо. Финальное решение за владельцем.

Открытые вопросы для владельца зафиксированы в ADR-002.

## [2026-04-25] ingest | dikidi.ru UI (12 скриншотов компании Samaya)
Владелец предоставил доступ к dikidi-аккаунту салона Samaya (ID 1674757, тариф PRO) через скриншоты. Извлечены факты:
- Полная карта 11 модулей dikidi → [[concepts/dikidi-feature-map]]: журнал записей, график работы, клиенты (с подразделами список/возвращаемость/бонусы/рассылки/звонки/сертификаты/чаевые/отзывы/штрафы), продвижение, сообщения, зарплата (расчёт + взаиморасчёты + начисления + схемы), продажи, финансы (доходы/расходы + счета/кассы + эквайринг + контрагенты + кассовые операции), товары (список + движения + склады + поставщики), настройки, тарифный план.
- Внешние интеграции: WhatsApp Business (рассылки), онлайн-касса 54-ФЗ, эквайринг, телефония, мобильное приложение салона.
- Бизнес-факты Samaya: косметологический салон, 12 сотрудников, 6963 клиента, оборот ~880k ₽/день, остатки ~240M ₽.
- Принят ADR-001 о scope MVP → [[decisions/2026-04-25-mvp-scope]]: Phase 0 = booking-only (4 сервиса: user/salon/booking/client + frontend), всё остальное (финансы, продажи, зарплата, склад, рассылки, бонусы) отложено в Phase 1+.
- Учтены архитектурные грабли food-flow: JWT fail-hard, multi-tenant с первого дня, `SELECT FOR UPDATE` на бронирование, тесты с первого дня, outbox для событий.
- Ингестов из репо samaya пока нет — кода нет, ждём go от владельца на скаффолдинг.

## [2026-04-25] feature | client-service + раздел «Клиенты → Список клиентов»
Реализован Phase 0a модуль клиентов как реплика DIKIDI-экрана.
- Миграция `005_clients.sql`: `clients.clients` — phone (CITEXT, UNIQUE per company), full_name, birthday, gender, email, comment, source, avatar_color, bonus_balance, is_blocked, is_deleted; trgm-индексы на full_name/phone, partial-индексы на active/blocked, триггер updated_at.
- Сервис `client-service:3004`: CRUD + сегментация на лету. Сегмент считается одним SQL-выражением `SEGMENT_EXPR` на CTE из `bookings.bookings`, связь `(company_id, client_id) OR (company_id, client_phone)`. Endpoint `/api/clients?segment=&search=&limit=&offset=`, `/api/clients/segments` (счётчики), `GET/POST/PUT/DELETE /:id`, `POST /:id/restore`.
- Сегменты повторяют DIKIDI: `regular`/`sleeping`/`missing`/`new`/`never`/`blocked`/`deleted`. Параметры в env: `CLIENT_REGULAR_DAYS=90`, `CLIENT_REGULAR_VISITS=2`, `CLIENT_SLEEPING_DAYS=90`, `CLIENT_MISSING_DAYS=180`, `CLIENT_NEW_PERIOD_DAYS=7`.
- Kong-route `/api/clients` → `client-service:3004`, добавлен в `kong/kong.yml` и `docker-compose.yml`.
- Frontend: новый view `clients` с sub-nav (Список клиентов / Возвращаемость / Бонусная программа / ... — последние disabled `data-pending="P1"`), toolbar с поиском + кнопкой «Добавить нового клиента» + меню «Экспорт в CSV», грид-таблица с аватаром (буква на цветном круге + цветная точка-сегмент), правый сайдбар категорий со счётчиками, модалка create/edit/soft-delete. CSV-экспорт текущей страницы на клиенте.
- Пойманные грабли:
  - `pg-promise` Parse падал «could not determine data type of parameter $2» при `($2::int || ' days')::interval`. Заменил на `CAST($N AS interval)` + передаю строки `'90 days'`. Дополнительно — count-запрос для `segment=all` не использовал $2..$5 в WHERE, добавил тривиальное `AND (SEGMENT_EXPR) IS NOT NULL`, чтобы все параметры получили контекст типа.
- Принят ADR-003 → [[decisions/2026-04-25-clients-segments-in-mvp]]: сегменты на лету (без matview), связи без FK (schema-per-service), сайдбар-модули (RFM/бонусы/рассылки/звонки) явно отложены в Phase 1.
- Тестовый сид: 27 клиентов из существующих bookings + 4 ручных; разброс по сегментам regular=21, sleeping=1, missing=1, never=2, new=1, blocked=1.


## [2026-04-26] refine | Журнал записей — period-pills, фильтры и donut-аналитика для Список-режима
По запросу владельца «доработать наше переключение в журнале» (опция 3 + DIKIDI-style фильтры + диаграммы в режиме Список). См. [[services/frontend-service]].

**Toolbar — period pills**:
- Заглушка-дропдаун «Все элементы 5 ▾» удалена (`index.html:402-406` была мёртвой).
- На её место — pill-группа `Сегодня / Завтра / Неделя / Месяц` (`.journal-period`, `index.html:402-407`).
- State `journalPeriod ∈ {day, week, month}` персистится в localStorage. Якорь — существующий `els.journalDate.value`.
- `getJournalRange()` (`app.js:267-285`) считает `{from, to}`: day → один день, week → пн-вс, month → 1-е-последнее.
- Активная подсветка пилюли через `updateJournalPeriodActive()`: «Сегодня» когда day+today, «Завтра» когда day+today+1, «Неделя»/«Месяц» — по period.
- Стрелки вперёд/назад теперь шагают единицами периода (`shiftJournalDate(±1)` → ±1 день / ±7 / ±1 месяц).
- `loadBookings` теперь использует range (`?from=&to=`) — backend уже умеет (`booking-service/src/routes/bookings.ts:12-24`, EXCLUDE-constraint от пересечений по-прежнему работает).

**Фильтры (только Список-режим)** — `.journal-filters-panel` (`index.html:464-512`):
- 8 контролов в 2 ряда как у DIKIDI: Рабочее время (P1, disabled), Сотрудники, Статус, Источник, Тип записи (P1), Автор записи (P1), Клиент (search), Аноним (checkbox), «Сбросить всё».
- Реальные фильтры — Сотрудник (master_id), Статус (`bookings.status` enum), Источник (`bookings.source`), Клиент (substring по name/phone), Аноним (без phone).
- `getFilteredBookings()` фильтрует client-side из `cachedBookings`. Источник заполняется уникальными значениями из ответа.
- В range-режимах (week/month) каждая строка списка получает префикс-дату «26 апреля» через `MONTHS_RU_GENITIVE` (общий с миникалендарём).

**Diagrams (Список-режим)** — `.journal-charts` (`index.html:516-548`):
- 4 SVG-donut'а в grid 4×1 (на узких экранах 2×2): Топ 5 сотрудников / Топ 5 услуг / Источники / Типы записей.
- Аггрегация — `aggregateTop()` + палитра `CHART_PALETTE` (6 цветов). >5 элементов → «Остальные».
- Топ 5 сотрудников: count per `master_id`. Топ 5 услуг: count per `b.services[].service_id` (плоский разворот). Источники: count per `b.source`. Типы записей: заглушка «Phase 1» (нет данных в схеме).
- Donut: stroke-dasharray на CSS-circle, центр — текст-total. Легенда — UL с цветной точкой + label + value (моноширинная цифра).

**Поломки/мелочи**:
- Коллизия с `MONTH_GENITIVE` — переиспользую существующий `MONTHS_RU_GENITIVE` и `WEEKDAYS_RU` (`app.js:222-226`), новый только `MONTH_NOM` (для «Апрель 2026» в month-режиме).
- `applyJournalMode()` теперь скрывает/показывает не только `journalCalendar`/`journalList`, но и `journalFiltersPanel`/`journalCharts` парой.
- Cal-toggle handler теперь зовёт `renderJournal()` вместо чистого `applyJournalMode()` — иначе при переключении на Список диаграммы оставались пустыми.
- Перед этим — отдельный фикс модалки: `[hidden]` атрибут не работал из-за `.modal { display: flex }` (тот же класс, но позже по source order). Добавлено `.modal[hidden], .modal-backdrop[hidden] { display: none }`. Также `.view-clients` без `.active` прокидывался поверх Профиля — поправлено по аналогии с `.view-journal.active`.

E2E проверки (рукой через UI после `docker compose up -d --build frontend-service`):
- Сегодня/Завтра pill переключают на нужную дату, остальные pill переключают период.
- Стрелки в day-режиме сдвигают на день, в week — на неделю, в month — на месяц.
- В режиме Список фильтры применяются мгновенно, «Сбросить всё» очищает.
- Диаграммы пересчитываются на каждом изменении фильтра.

## [2026-04-26] ingest | DIKIDI deep-analysis screenshots + extraction artifacts → [[concepts/dikidi-screenshots-index]], [[concepts/dikidi-finance]], [[concepts/dikidi-extraction-attempts]], [[concepts/dikidi-feature-map]] extended
Консолидированы все артефакты двухдневного исследования DIKIDI Business в Wiki:
- **NEW** [[concepts/dikidi-screenshots-index]] — каталог 54 скриншотов (`/tmp/dikidi_screenshots/` — 23, `/tmp/dikidi_screenshots2/` — 31) с одной строкой описания и привязкой к модулю; группировка по модулям samaya для быстрой навигации.
- **NEW** [[concepts/dikidi-finance]] — детальный разбор Финансов под предстоящую реализацию: 5 sub-tab (Доходы и расходы / Счета и кассы / Эквайринг / Контрагенты / Кассовые операции), 5 модалок операций (+ 2 справочные), реальные остатки 3 счетов Samaya, KPI-структура, period-pills, рекомендации по MVP-scope для finance-service.
- **NEW** [[concepts/dikidi-extraction-attempts]] — постмортем скрапинга: bot-protection (`js-challenge-script`), login-флоу через `sw.auth.modal()` с Bulgaria-default + cookie-overlay, 59 итераций Playwright-скриптов в `/tmp/dikidi_*.js`, объяснение 3520-байтных placeholder-бандлов и VK.ru вызовов (VK Retargeting pixel `VK-RTRG-467097-hSv3t`). Вывод: скриншоты — единственный надёжный артефакт; пересъёмка — через реальный Chrome с auth cookies.
- **EXTEND** [[concepts/dikidi-feature-map]] — добавлены секции «Финансы (детально)» с реальными счетами Samaya и cross-link на [[concepts/dikidi-finance]], «Зарплата (детально)» с описанием 4 sub-tab (Расчёт зарплаты / Взаиморасчёты / Начисления / Схемы расчёта).
- **UPDATE** [[index]] — 3 новых страницы в Concepts.
- **UPDATE** [[sources]] — добавлены строки для `/tmp/dikidi_screenshots*/` и `/tmp/dikidi_full/` + `/tmp/dikidi_forms*/` + 59 `dikidi_*.js`.

## [2026-04-26] ingest | DIKIDI screenshots → Wiki/attachments/ + inline embeds в [[concepts/dikidi-screenshots-index]]
Все 54 скриншота скопированы из `/tmp/dikidi_screenshots*/` в `Wiki/attachments/dikidi/pass1/` (23 файла, 4.2MB) и `Wiki/attachments/dikidi/pass2/` (31 файл, 4.4MB), итого 8.5MB внутри вики (т.е. зафиксированы в репо, не зависят от живучести `/tmp`). [[concepts/dikidi-screenshots-index]] переписан с использованием Obsidian-синтаксиса `![[attachments/dikidi/passN/файл.png|180]]` — теперь каждая строка таблицы имеет inline-превью 180px. [[sources]] обновлён — путь `/tmp/dikidi_screenshots*/` заменён на `Wiki/attachments/dikidi/pass{1,2}/`.

## [2026-04-27] ingest | DIKIDI pass3 — оставшиеся модалки и sub-tabs → `Wiki/attachments/dikidi/pass3/`
Добавлены 34 скриншота (~7MB) — модалки и sub-pages, которых не было в pass1/2. Использованы 2 Playwright-скрипта: `/tmp/dikidi_screens3.js` (URL-based, 26 валидных + 15 404-страниц), `/tmp/dikidi_screens4.js` (click-based, 8 валидных). Покрыто:
- Журнал «+ Запись» modal
- Услуги: list + Add modal + Category modal
- Клиенты sub-tabs (5 из 8): Рассылка/Звонки/Сертификаты/Чаевые/Отзывы/Штрафы + create-mailing modal
- Продажи: list + Sale Wizard step1
- Товары: list + Add modal + Receipt modal + Movements/Warehouses/Suppliers (через sidebar nav)
- Зарплата: + Schema modal (видно 3 radio типа)
- Настройки: Уведомления / Платежи / Шаблоны (профиль/доступ — 404)
- Сообщения: list + thread (URL `/owner/chat/`, не `/messages/` — ключевая находка)
- Продвижение, Тарифный план, Центр поддержки

Не сняты (нужен ручной обход): Возвращаемость, Бонусная программа (табы внутри /clients/, не URL); Профиль компании, Виджет, Доступ/Роли, Интеграции (sub-URL'ы возвращают 404 без активного клика); Финансы filter drawer (cookie overlay).

[[concepts/dikidi-screenshots-index]] расширен новой секцией Pass 3 + обновлена таблица группировки. [[sources]] обновлён.

## [2026-04-27] ingest | DIKIDI pass5 — 3 эталонных скрина (sidebar/subnav/Sale Wizard)
Pass 5 (`/tmp/dikidi_screens5.js`) — focused click-inside-page navigation. Большинство кликов («Возвращаемость», «Бонусная программа», «Настройки → Профиль», «Добавить сотрудника») не сработали из-за DIKIDI's collapsed sidebar в новой UI. Но 3 скриншота попали в десятку:
- `journal_full_sidebar.png` — **полный левый сайдбар DIKIDI** (12 пунктов меню, видно реальную структуру навигации)
- `clients_full_subnav.png` — **полный sub-nav Клиентов** (9 табов слева видны как пункты, плюс правый сайдбар сегментов с реальными цифрами Samaya: VIP 247, Спящие 1058)
- `sale_wizard_modal.png` — **модалка «Оформить продажу»** (Sale Wizard с табами Услуги/Товары/Сертификаты, грид строкой исполнитель/услуги/материалы/цена/скидка/итого, кнопками «Перейти к оплате» / «Сохранить») — этот скрин был holy grail для будущего Sales-модуля samaya.

Итого pass3 = 37 PNG (~8.1MB). Total Wiki: 91 скриншот, ~16MB.

## [2026-04-27] ingest | DIKIDI pass6+7 — sub-tabs клиентов + правильный URL финансов
**Pass 6** (`/tmp/dikidi_screens6.js`) — click-by-text без фильтра по координатам. Получил 7 sub-tabs Клиентов: Возвращаемость, Бонусная программа, Рассылка, Звонки, Чаевые, Отзывы, Штрафы (Сертификаты не нашёл). Также захватил детальную карточку клиента.

**Pass 7** (`/tmp/dikidi_screens7.js`) — пользователь подсказал правильный URL: `/owner/biz_cashflow/` (не `/owner/cashflow/`). Это исправило главную дыру в pass1/2/3 — Финансы теперь сняты ПОЛНОСТЬЮ:
- Доходы и Расходы — эталонный layout (4 KPI с donut'ами, period pills, все кнопки)
- Счета и кассы — реальные остатки Samaya (0.45 / 38М / 203М)
- Эквайринг — настройки POS
- Контрагенты — список + детальная карточка
- Кассовые операции — 54-ФЗ

Также pass7 спекулятивно тестировал `biz_*` префикс для других секций (settings/promotions/messages/sales/products/etc) — большинство 404'нулись (`biz_*` есть только у финансов). Несколько работающих: `biz_journal`, `biz_clients`, `biz_salary` — это редиректы на основной URL, дубли с pass1/2.

Итого pass3 = 50 PNG (~11MB). Total Wiki: 104 скриншота, ~20MB.

## [2026-04-27] ingest | DIKIDI pass8+9 — DOM URL discovery + 29 финальных скринов
**Pass 8** (`/tmp/dikidi_screens8.js`) — DOM-дамп всех `<a href="/owner/...">` с авторизованного DIKIDI. Получил полную карту 50+ URL'ов: `/owner/retention/`, `/owner/bonuses/`, `/owner/ats/`, `/owner/payroll/`, `/owner/salaryMutualSettlements/`, `/owner/salarySheets/`, `/owner/salarySchemes/`, `/owner/profile/`, `/owner/masters/`, `/owner/propertiesOfOnlineRecord/`, `/owner/permissions/`, `/owner/integration/type/`, `/owner/acquiring/`, `/owner/cashequipment/` и т.д. Сохранено в `/tmp/dikidi_owner_urls.json`. Это сняло главную проблему всех предыдущих passes — угадывание URL'ов.

**Pass 9** (`/tmp/dikidi_screens9.js`) — точечный обход 29 настоящих URL'ов. **ВСЕ 29 валидные** (>50KB), без 404. Покрыто:
- Клиенты sub-tabs (4): Возвращаемость, Бонусы, Звонки (ATS), Сертификаты
- Зарплата sub-tabs (4): Расчёт, Взаиморасчёты, Начисления, Схемы
- Финансы (4): Кассы, Эквайринг, Контрагенты, Кассовые операции — все по правильным URL
- Настройки (9): **Профиль компании, Виджет онлайн-записи, Доступ/Роли, Интеграции, Лицевой счёт, Оповещения, Ресурсы** + Услуги/Сотрудники
- Аналитика продаж, Движения товаров, Склады
- Продвижение: Акции (1.2MB!), Премиум, Реферальная программа
- Журнал групповых записей, Статистика уведомлений

Итого pass3 = 79 PNG (~17MB). **Total Wiki: 133 скриншота, ~27MB.**

Закрыты все «дыры» из предыдущих passes: Профиль компании, Виджет, Доступ, Интеграции, Возвращаемость, Бонусная программа, Звонки, Сертификаты, все зарплатные sub-tabs, Аналитика, Реферальная программа.

## [2026-04-27] ingest | DIKIDI pass12 — Locator API пробил клики на строки
**Pass 12** (`/tmp/dikidi_screens12.js`) — переход с `el.click()` через `evaluate` на Playwright `locator.first().click()` который симулирует реальные mouse-события. Это пробило DIKIDI's JS click handlers. Захвачены **edit-модалки** которые во всех предыдущих passes 4-11 не открывались:

- **Карточка сотрудника со всеми 7 табами** (Профиль/График/Онлайн-запись/Услуги/Схемы ЗП/Доступ/Фото работ/Оповещения) — главный артефакт для samaya реализации Sprint
- Модалка редактирования услуги
- Карточка клиента (детальная)
- Sale Wizard расширенный вид

Не сняли (мало записей в today): booking detail card.

Итого pass3 = 103 PNG (~31MB). **Total Wiki: 157 скринов, ~31MB.**

## [2026-04-27] ingest | DIKIDI manual capture — 15 эталонных скринов от пользователя
Пользователь вручную (Cmd+Shift+4) снял 15 экранов в реальном Chrome — то что Playwright не пробил из-за DIKIDI's send-message-modal перехватывающей pointer-events:

**Карточка сотрудника-врача — все 8 табов** (Балакеримова Зухра):
- Профиль / График / Онлайн-запись / Услуги / Схемы ЗП / Доступ / Фото работ / Оповещения

**Booking detail modal** «Изменение записи»: услуги-таблица, клиент с историей, источник, цвет записи, итого/оплачено/долг, 4 кнопки (Перейти к продаже / Отменить / Повторить / Сохранить).

**Продажи** — 6 скринов: KPI оборот/себестоимость/прибыль×4 периода (Сегодня/Неделя/Месяц/Год) + раскрытая строка с детализацией (Услуги/Сотрудник/Расходы/Зарплата/Прибыль).

Реальные числа Samaya за год: оборот **101 409 401₽**, прибыль **100 401 070.80₽** (99.01% маржа — DIKIDI считает прибыль = оборот − себестоимость, не учитывая зарплаты + аренду).

Итого pass3 = 120 PNG (~50MB). **Total Wiki: 174 скрина, ~50MB.**
