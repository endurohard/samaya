---
type: service
status: stable
last_verified: 2026-04-25
sources:
  - services/frontend/
---

# frontend-service

Минимальный admin SPA для визуализации Phase 0 функционала. Без сборщиков, без React — только HTML/CSS/vanilla JS, обслуживается nginx-контейнером. Будет переписан на React/Vite в Phase 0a iteration или Phase 1, когда модулей станет больше.

- **Хост-порт**: `${FRONTEND_PORT:-3010}` (хост 3000 обычно занят)
- **Внутри контейнера**: nginx на 80
- **API-проксирование**: nginx `location /api/` → `http://kong:8000` (same-origin для фронта, без CORS)

## Структура

```
services/frontend/
├── Dockerfile        nginx:1.27-alpine
├── nginx.conf        proxy /api/* → kong:8000, SPA fallback на /
└── public/
    ├── index.html    оболочка (header + auth + modules + log)
    ├── app.js        ваниль JS — auth flow, status probe, JWT decode
    └── style.css     тёмная тема а-ля dikidi
```

## Что показывает

1. **Header**: бренд, метка фазы, индикатор статуса backend (зелёный/жёлтый/красный + надпись).
2. **Auth-карточка**:
   - Гость: табы Войти / Регистрация. Поля принимают email **или** телефон (определяется по наличию `@`). Роль выбирается из `client/master/admin/owner`.
   - Залогинен: аватар (генерируется из user_id), имя, email/phone, **claims из JWT** (sub, company_id, role, exp). Кнопки `Обновить токены` (refresh с ротацией) и `Выйти`.
3. **Modules**: 4 placeholder-карточки с pill-статусом «ожидает X» — Журнал записей, График мастеров, Клиенты, Склад. Заполнятся по мере подключения сервисов.
4. **API лог**: live-журнал HTTP-запросов (метод, путь, статус, время) — удобно видеть, что происходит.

## Хранилище

`localStorage`:
- `access_token` — JWT
- `refresh_token` — opaque строка
- `user` — JSON с публичными полями

При logout всё чистится.

## Status probe

Каждые 10 сек: `GET /api/auth/me` без bearer.
- 401 → backend OK (сервис ответил структурированной ошибкой)
- 5xx → backend down
- network error → kong/proxy down

Это самый дешёвый способ убедиться, что весь путь nginx → kong → user-service → postgres жив (потому что `verifyAccess` с пустым токеном даже не доходит до DB, но если /api/auth/me вернул JSON — значит весь стек ответил).

## Публичный виджет онлайн-записи

`http://localhost:3010/widget.html` — отдельная страница без auth, сделанная для конечного клиента (мобильно-ориентированный портрет, 640px max).

5 шагов в одном экране (последующие шаги появляются по мере заполнения):
1. **Услуги** (multi-select) — `/api/salons/public/services`
2. **Мастер** (single-select) — `/api/salons/public/masters`
3. **Дата** (`<input type="date">`, min = сегодня)
4. **Время** (grid слотов от `/api/bookings/slots`, шаг 15 мин)
5. **Контакты** — имя, телефон, опц. комментарий → `POST /api/bookings/public/create`

**Sticky summary-карточка** (тёмный градиент): услуги → мастер → когда → итого (₽ + длительность). Обновляется при каждом изменении состояния.

При успешном бронировании показывается **success-screen** с галочкой и подтверждением.

Обработка `409 SLOT_TAKEN`: показывается красный баннер «это время только что забронировали», слоты автоматически перезагружаются.

`widget.css` отдельный (не пересекается со `style.css` админки) — переменные с префиксом `--w-*`.

Внизу — `«Я администратор салона»` ссылка обратно на `/`.

## Что НЕ делает (намеренно)

- Не хранит токены в cookie (HttpOnly cookies — позже, когда будет CSRF + secure context).
- Не авто-рефрешит при 401 на business-запросах — пока business-запросов нет.
- Не валидирует exp клиентом перед запросом (сервер сам отвергнет — нет смысла дублировать).
- Нет роутера. Один экран. Маршрутизация добавится при подключении модулей.

## Связи

- Зависит от [[user-service]] (через [[#API-проксирование]]).
- Будет потреблять API всех остальных сервисов Phase 0 по мере их подключения.

## Журнал — toolbar и аналитика (2026-04-26)

Тулбар журнала состоит из четырёх блоков (`index.html:390-426`):
1. **Cal-toggle** — 3 иконки: Календарь / Список / По мастерам. Кнопка «По мастерам» визуально активна, но логически дублирует «Календарь» (см. `app.js:1144-1146` — TODO: развести по смыслу или убрать).
2. **Period-pills** — `Сегодня / Завтра / Неделя / Месяц` (`.journal-period`). Управляют `journalPeriod ∈ {day, week, month}` + якорной датой. `Сегодня`/`Завтра` — quick-jump (period=day, date=today/tomorrow); `Неделя`/`Месяц` — переключение периода. Подсветка через `updateJournalPeriodActive()`.
3. **Date-nav** — стрелки вперёд/назад (`shiftJournalDate(±1)` шагает единицей периода) + кнопка с текстом `formatRangeLabel()` (день: «Вс, 26 апреля», неделя: «20–26 апр» или с двумя месяцами, месяц: «Апрель 2026») + скрытый `<input type="date">` для прямого выбора.
4. **Действия** — `+ Добавить запись` (открывает details-форму), `Оформить продажу` (Phase 1, alert-заглушка).

`loadBookings` зовёт `/api/bookings?from=&to=` через `getJournalRange()` (`app.js:267-285`). Backend поддерживает range через `WHERE starts_at BETWEEN $2::date AND $3::date + 1d` (`booking-service/src/routes/bookings.ts:23`).

### Список-режим — фильтры и диаграммы

Только в `journalMode === 'list'` дополнительно показываются:

**`.journal-filters-panel`** (`index.html:464-512`) — DIKIDI-подобная панель 8 контролов в 2 ряда:
- Реальные: Сотрудники (master_id), Статус (`bookings.status` enum: pending/confirmed/completed/canceled/no_show), Источник (уникальные `b.source` из ответа), Клиент (substring по name/phone, debounce 250ms), Аноним (без phone).
- Заглушки `disabled title="Phase 1"`: Рабочее время, Тип записи, Автор записи.
- `getFilteredBookings()` — client-side фильтрация на `cachedBookings`. Кнопка «Сбросить всё».

**`.journal-charts`** (`index.html:516-548`) — 4 SVG donut'а 4×1 (на ≤1100px → 2×2):
- Топ 5 сотрудников: count per `master_id`, label из `cachedMasters[].display_name`.
- Топ 5 услуг: плоский разворот `b.services[].service_id` → count per service.
- Источники записей: count per `b.source` (`manual/widget/public/api`).
- Типы записей: заглушка «Phase 1» (поля в схеме нет).

`aggregateTop()` строит топ-N + бакет «Остальные»; donut рисуется через stroke-dasharray на circle r=15.915 (длина окружности = 100), палитра `CHART_PALETTE` из 6 цветов. В центре — total. Легенда — UL с точкой/label/value.

**В range-режимах** (week/month) каждая строка списка получает префикс-дату «26 апреля» (`MONTHS_RU_GENITIVE`).
