---
type: audit
status: stable
last_verified: 2026-07-13
sources:
  - "PR #1 (ветка fix/audit-findings)"
  - services/booking-service/
  - services/inventory-service/
  - services/finance-service/
  - services/salary-service/
  - services/whatsapp-service/
  - services/salon-service/
  - services/client-service/
  - services/frontend/
  - database/migrations/028_bonus_operations.sql
  - database/migrations/029_movements_idempotency_null_lot.sql
  - database/migrations/030_finance_source_and_delta.sql
  - database/migrations/031_reminder_channel_flags.sql
---

# Аудит корректности и безопасности (2026-07-13)

Полный аудит всех 9 сервисов, БД, docker-compose и kong тремя параллельными
ревью-агентами. Найдено ~30 проблем (4 critical, 7 high, остальные medium/low);
все исправлены в PR #1 (ветка `fix/audit-findings`), 4 коммита по уровням
серьёзности. Все сервисы проходят typecheck, 59 unit-тестов зелёные.

Связанные страницы: [[../services/booking-service]], [[../services/inventory-service]],
[[../services/salon-service]], [[../services/client-service]], [[../services/frontend-service]],
[[../concepts/inventory-tech-cards]], [[../concepts/dikidi-finance]].

## Critical (денежные дыры / целостность / ПДн)

### C1. Бонусы «из воздуха»
`services/booking-service/src/routes/bookings.ts` (`/:id/complete`).
`bonus_spend`/`bonus_accrual` писались только в строку записи, а
`clients.clients.bonus_balance` **не менялся**; списание не валидировалось →
`paid_amount = total − discount − bonus_spend` мог стать отрицательным, и при
`payment_method='balance'` баланс клиента **рос**.
**Фикс:** сервер валидирует списание (≤ чек / ≤ бонусный баланс / ≤ `max_spend_pct`),
сам считает начисление по `accrual_rate`, двигает `bonus_balance` в транзакции.
Журнал `clients.bonus_operations` (миграция 028). Настройки —
`salons.company_profile.settings_jsonb->'bonus'`.

### C2. «Отравленное» событие инвентаря
`services/inventory-service/src/worker.ts`.
Общий расходник у двух услуг записи → повтор `INSERT` в `stock_movements`
даёт `23505` внутри транзакции → `25P02` (aborted) → компенсирующий UPDATE тоже
падает → ROLLBACK всего события → оно переобрабатывается вечно, списания нет.
**Фикс:** `SAVEPOINT`/`ROLLBACK TO SAVEPOINT` вокруг вставки движения; потребление
агрегируется по продукту через все услуги записи (дублей внутри записи нет).
Дедуп виртуальных движений `stock_insufficient` при `lot_id IS NULL` через
`COALESCE(lot_id, нулевой uuid)` (миграция 029). Связано с [[../concepts/inventory-tech-cards]].

### C3. Двойное списание при выплате ЗП
`services/salary-service/src/routes/payouts.ts` + `services/finance-service/`.
Вызов finance `/operations/expense` без идемпотентности; `/:id/retry` без
row-lock → повтор/гонка создавали вторую расходную операцию.
**Фикс:** идемпотентный ключ `source_type='salary_payout'`/`source_id=payout_id`;
finance при конфликте по уникальному индексу возвращает существующую операцию и
**не трогает баланс**; retry под `FOR UPDATE`. Уникальный индекс
`finance.operations(company_id, source_type, source_id)` (миграция 030).

### C4. WhatsApp слал сообщение не тому получателю
`services/whatsapp-service/src/whatsapp.js`.
Единственная страница Puppeteer, параллельные `/send`/`/broadcast` перемешивали
`_openChat` и ввод текста → сообщение уходило чужому клиенту (утечка ПДн).
**Фикс:** очередь-мьютекс (`_enqueue`) сериализует все операции со страницей.

## High

- **H1** `finance.operations`: знаковый `balance_delta` (миграция 030) — корректный
  реверс `adjust` при удалении (раньше знак терялся из-за `Math.abs`), `FOR UPDATE`
  + атомарный guard `is_deleted=FALSE` (нет двойного реверса при гонке DELETE).
- **H2** Публичная запись `/api/bookings/public`: серверная валидация `starts_at`
  (не в прошлом, в графике мастера `salons.master_schedules`, не выходной) —
  `assertBookingWithinSchedule`. Rate-limit на роут уже был в kong.
- **H3** Kong Admin API убран с внешнего порта: `KONG_ADMIN_LISTEN=127.0.0.1:8001`,
  порт 8001 не публикуется (`docker-compose.yml`).
- **H4** Frontend: single-flight refresh (`services/frontend/src/app.js`) —
  параллельные 401 ждут один обмен ротируемого refresh-токена, нет ложного разлогина.
- **H5** WhatsApp: закрытие браузера при сбое init (нет утечки Chromium) +
  health-check сессии с авто-reinit при разлогине.
- **H6** Retention-аналитика группирует по `COALESCE(client_id, client_phone)` —
  нет задвоения клиента из-за разного формата телефона/имени.
- **H7** WhatsApp broadcast — фоновый job (202 + `/broadcast/status`), не держит
  HTTP-ответ минуты (иначе обрыв по proxy-timeout шлюза).

## Medium

- **M1** `percent_goods` проброшен через расчёт ЗП (`calculate.service.ts`), но
  **источника продаж товаров в пайплайне нет** — начисление считается по `goodsTotal=0`;
  нужен отдельный фид продаж товаров, чтобы реально платить.
- **M2** Сбой booking-service при расчёте ЗП → **502**, а не 200 с тихими нулями.
- **M3** Пул комиссий делится методом наибольшего остатка (Σ долей == пулу).
- **M4** Месячная ставка ЗП делится на реальное число дней месяца, не фикс. 30.
- **M5** Телефон в `bookings` хранится нормализованным (единый формат с карточкой
  клиента); фильтр списка нормализуется.
- **M6** Единое определение визита/выручки (`status='completed'`, нетто
  `total_price − discount_amount`) в списке/карточке/экспорте/портале
  ([[../services/client-service]]).
- **M7** Запись не привязывается к заблокированной карточке (409 для онлайна),
  реактивирует удалённую (`client-link.ts`).
- **M8** `requirePermission` **fail-closed** во всех 6 сервисах: нет claim
  `permissions` в токене → 403 (раньше `next()`). Все выпускаемые токены claim несут.
- **M9** Роль `master` действует только со своими записями (create/complete/cancel) —
  `assertMasterActor` (`salons.masters.user_id = req.auth.sub`).
- **M11** ffmpeg-транскод: очередь с лимитом параллелизма + таймаут (`kill`) —
  защита от OOM (mem_limit 1g) и зависаний ([[../services/salon-service]]).
- **M12** Уникальный tmp-путь на задачу транскода — нет гонки при повторной загрузке.
- **M13** Склад по умолчанию выбирается по `is_default`, не по `created_at`
  (консистентно с воркером).
- **M15** Слоты и валидация времени считаются по per-company IANA `timezone`
  (учёт DST) с fallback на фикс. офсет `COMPANY_TZ_OFFSET` (`services/booking-service/src/tz.ts`).
- **M16** Виджет показывает время слотов в TZ салона (из `meta.timezone`), не браузера.

## Low

- **L1** `/no-show` согласован с `/cancel` (`canceled_at` + outbox `booking.no_show`).
- **L2** Пер-канальные отметки напоминаний (миграция 031) — провал email не
  дублирует WA.
- **L3** Время записи в напоминаниях в строгом ISO (не хрупкий `::text`).
- **L5** `redeem` сертификата возвращает `requested`/`partial` при неполном списании.
- **L6** Дедуп виртуальных движений инвентаря (вместе с C2, миграция 029).
- **L7** WhatsApp: валидация телефона (реджект мусора/короткого).
- **L8** WhatsApp: constant-time сравнение внутреннего токена, узкий `pkill` по
  своей сессии, process-хендлеры `unhandledRejection`/`uncaughtException`.
- **L9** WhatsApp: подтверждение отправки (очистка поля ввода) перед `success`.
- **L10** Виджет: защита от stale-ответа `loadSlots` (токен запроса).
- **L11** Портал: проверка `res.ok` при удалении файла, сообщение об ошибке аплоада,
  клиентская валидация 15 МБ ([[../services/frontend-service]]).
- **L12** `build.mjs`: экранируются все точки в ссылках; `preview.html` не публикуется
  в `dist` (раздаётся nginx без авторизации).
- **L13** `widget.js`/`service.html` пробрасывают `company_id` из URL
  (мультиарендность; бэкенд уже поддерживает, дефолт — `DEFAULT_COMPANY_ID`).

## ⚠️ Изменения поведения (важно при деплое)

1. **Прогнать миграции 028–031** (бонусные операции, идемпотентность
   movements/finance, per-channel напоминания).
2. **RBAC теперь fail-closed** — токен без claim `permissions` → 403 (все текущие
   токены claim несут; короткоживущие legacy уже истекли).
3. **Расчёт ЗП падает 502** при недоступном booking-service (раньше — тихие нули).

## Отложено (осознанно, не в PR #1)

- **L4** Расход/перевод в finance может увести баланс в минус — оставлено как
  бизнес-решение, требует подтверждения правила владельцем.
- **M1** Начисление ЗП за товары: проводка готова, нужен фид продаж товаров.
