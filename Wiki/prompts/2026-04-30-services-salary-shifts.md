---
type: prompt
status: draft
created: 2026-04-30
purpose: Запрос на расширение модулей Услуги / Зарплата / График для реальных процессов Samaya
related:
  - "[[../design/dikidi-clone-spec]]"
  - "[[../concepts/dikidi-feature-map]]"
  - "[[../concepts/inventory-tech-cards]]"
---

# Промпт — Услуги-техкарты, менеджерские %/бонусы, график техничек

Запускать в новом чате с агентом, который умеет работать со стеком samaya.

---

## Контекст

Ты — Senior Full-stack инженер для проекта **samaya** — SaaS-платформы для управления косметологическим салоном (B2B, owner + админы + мастера + менеджеры + технички). In-house клон DIKIDI Business для одной компании клиента (Samaya, ID 1674757).

**Стек**: vanilla JS + чистый CSS, без фреймворков. Один `index.html`, один `app.js` (~3700 строк), один `style.css` (~3900 строк). Бэкенд — 5 микросервисов (Node.js + Postgres) за Kong API gateway: user-service, salon-service, booking-service, inventory-service, frontend-service. Адмика рендерится на nginx, порт 3010.

**Live**: http://localhost:3010 — рабочие модули Журнал, График, Клиенты, Услуги, Мастера, Склад, Финансы, Зарплата (Sprint 1-2 готовы — расчёт по схемам, схемы CRUD, взаиморасчёты, начисления, модалки `payout / accrual_create / payroll_run / scheme_create` через localStorage, ждёт миграции в реальный salary-service).

**Дизайн-spec**: `Wiki/design/dikidi-clone-spec.md` — палитра, токены, паттерны (subnav, modal, period-pills, sal-grid, fin-kpi-card). Использовать существующие компоненты, не плодить новые.

## Задача

Расширить три модуля (Услуги, Зарплата, График) под реальные процессы Samaya. Сейчас в проекте этих сценариев нет — нужно спроектировать данные, API и UI, и реализовать.

### 1. Услуги ↔ Техкарты (расширение существующего)

Сейчас:
- Есть таблица `services` (id, name, price, duration_minutes, category, color, is_active)
- Есть таблица `tech_cards` в inventory-service: `tech_cards (service_id, version)` + `tech_card_items (product_id, qty_per_service)` — расход материалов на 1 услугу
- В админке `Услуги` создание/редактирование услуги. В `Склад → Техкарты` — отдельный экран с привязкой material → service

Нужно:
- В модалке услуги (`service_edit`) добавить вкладку или секцию «Расходники (техкарта)». Inline-таблица: продукт из `inventory_products` + qty + единица. Кнопка `+ Позиция`. При сохранении услуги — синхронно сохранять `tech_card_items` (одна транзакция через оба сервиса либо событие `service.saved → inventory.upsert_tech_card`).
- Версионирование: при изменении количества или замене продукта — `tech_card.version++`. История прежних версий — read-only список под inline-таблицей с датой и автором.
- Кнопка `Применить ко всем активным записям` (опционально, опасная) — пересчитать расход для уже завершённых, но ещё не списанных бронирований.

### 2. Зарплата менеджеров: процент за услугу + фикс за рекомендацию

Сейчас в зарплатных схемах три типа: `rate / rate_plus_percent / percent_only`. Все оперируют **общим** процентом с продаж. Реальный кейс Samaya сложнее:

- У менеджера (роль `manager`) есть **per-service** проценты. Например: за «ЛЛ живота» — 5% от чека, за «ЛЛ рук» — 7%, за «Чистка лица» — 0%.
- Дополнительно: за рекомендацию некоторых услуг менеджер получает **фиксированную сумму** (bonus за upsell). Например: предложил клиенту «Пилинг» дополнительно к основной услуге → +500 ₽ менеджеру независимо от чека.
- Один менеджер «оформляет» запись (поле `booking.created_by_user_id`); если он же «предложил» доп.услугу — поле `booking_service.recommended_by_user_id` (per-line).

Нужно:
- Новая таблица `salary_service_rates`:

  ```
  id, scheme_id (FK), service_id (FK), percent_of_total NUMERIC(5,2),
  fixed_bonus_amount NUMERIC(10,2), bonus_only_if_recommended BOOLEAN
  ```

  (если `bonus_only_if_recommended=true` — bonus начисляется только когда `booking_service.recommended_by_user_id = manager.user_id`)
- Расширить тип схемы `manager_per_service` (новый вариант radio в модалке `salary_scheme_create`). Когда выбран — открывается под-форма-таблица: одна строка на услугу (preload активных услуг), 3 колонки: `% от чека`, `Фикс. бонус, ₽`, `только если предложил ☐`.
- Расчёт ЗП в `Расчёт зарплаты` для менеджера = `sum(booking_service.line_total * rate.percent_of_total) + sum(rate.fixed_bonus_amount * matches)`. Колонки таблицы Tab 1 уже есть (`% с продаж` — показываем процентную часть, `Гарантированная` — фикс-бонусы; либо ввести новую колонку «Бонусы»).
- В Tab 3 «Начисления» добавить тип `recommend_bonus` с источником «Рекомендация: Пилинг (Иванова, 25.04)».

### 3. График работы техничек + расчёт ЗП за выход

Сейчас «График работы» показывает мастеров (которые принимают записи). Технички (уборщицы, помощницы) в записях не участвуют, но получают **оплату за факт выхода на смену** — независимо от записей.

Нужно:
- Расширить таблицу `masters` или ввести новую `staff` с полем `staff_kind`: `master / manager / technician / admin`. Технички и менеджеры в журнал-выпадашках не показываются, но появляются в графике и зарплате.
- На странице `/schedule` рядом с фильтром сотрудников — переключатель `[Мастера | Технички | Все]`. Сетка та же самая, но строки фильтруются по `staff_kind`.
- Для техничек ячейка графика хранит `start_time / end_time / arrived_at / left_at` (план vs факт). По умолчанию `arrived/left` заполняются при сохранении графика = плановые; админ может корректировать постфактум через cell-edit modal.
- Расчёт ЗП техничке (новый тип схемы `per_shift_rate`):
  - `rate_per_shift NUMERIC(10,2)` — фиксированная оплата за выход
  - `min_hours NUMERIC(4,2)` — если факт меньше → выплачиваем пропорционально (или `0` если меньше min)
  - `overtime_rate NUMERIC(10,2)` — оплата сверх плана

  Формула:

  ```
  shift_pay = if hours_actual >= shift_planned: rate_per_shift + overtime_rate * (hours_actual - shift_planned)
            elif hours_actual >= min_hours:    rate_per_shift * (hours_actual / shift_planned)
            else:                               0
  ```

- В Tab 1 «Расчёт зарплаты» для техничек показывать новые колонки или те же: «К начислению» = `sum(shift_pay)` за период.
- В Tab 3 «Начисления» новый тип `shift_pay` с источником «Смена 25.04, 10:00–20:00 (10ч), Иванова».

### 4. Кросс-связь Зарплата ↔ Финансы

Когда происходит выплата (через модалку `salary_payout`) или начисление через `payroll_run` — должна создаваться операция в Финансах:

- Income/expense type: `expense`
- category: `Зарплата`
- counterparty: `master_id` (через mapping или текстом «ЗП Иванова»)
- account_id: выбранный в модалке выплаты счёт
- linked_to: `salary_accrual.id` (для bidirectional навигации)

При клике на операцию «зп иванова» в Финансах → открывает Зарплата → Начисления с фильтром по master.

## Дизайн-конвенции (обязательно)

- Subnav: `<button class="subnav-item">` с `.active`. Не tabs-with-underline.
- Модалки: `.modal-backdrop > .modal` с `.modal-head / .modal-body / .modal-foot`. Esc и клик-вне закрывают. На мобиле fullscreen.
- Таблицы: `.sal-grid` с шапкой `.sal-grid-head` и строками `.sal-row`. Не `<table>`.
- Period pills: `.period-pill` с `data-period`.
- KPI: `.fin-kpi-card`.
- Цветовая семантика: `--success` зелёный (доход/+), `--danger` красный (расход/−), `--primary` фиолетовый (action), `--warn` жёлтый (внимание/корректировка).
- Без эмодзи. Иконки — inline SVG 16×16 stroke 1.6 `currentColor` (Heroicons).
- Mobile-first responsive: ≤ 900px sidebar → drawer, форма в 1 колонку, модалки fullscreen.

## Deliverables

Для каждого из 4 пунктов:

1. **Schema migration** (SQL): таблицы, FK, индексы, RLS-политики (если используется). Файл: `database/migrations/20260430_<feature>.sql`.
2. **API endpoints** (Express handlers): GET/POST/PUT/DELETE с Zod-валидацией. Описать request/response JSON примеры.
3. **HTML** (фрагмент в `index.html`): новые view/modals с полным разметкой.
4. **CSS** (в `style.css`): только новые компоненты, переиспользовать существующие токены.
5. **JS** (в `app.js`): IIFE-блоки внутри основного wrapper, hook'и в `setView`, localStorage fallback для оффлайн-разработки + TODO-комментарии где заменять на real API.
6. **Wiki-doc** (`Wiki/decisions/2026-XX-XX-<feature>.md`): ADR с описанием решения, trade-offs и план миграции данных (если нужно ломать существующие схемы).

## Что НЕ нужно

- Не переходить на React/Vue/TypeScript-frontend — стек зафиксирован.
- Не плодить новые design tokens.
- Не делать messaging / 54-ФЗ / эквайринг-online — отложено.
- Не ломать существующие схемы зарплаты (`rate / rate_plus_percent / percent_only`) — добавлять новые типы как варианты, не замена.

## Output limit

Под 3500 строк суммарно. Приоритет: п.3 (график техничек + `per_shift_rate`) → п.2 (per-service менеджерские проценты) → п.1 (услуги-техкарты UI расширение) → п.4 (Финансы интеграция).

## Источники для контекста

- `Wiki/design/dikidi-clone-spec.md` — полная design-spec на 6 модулей
- `Wiki/concepts/dikidi-feature-map.md` — карта фич DIKIDI
- `Wiki/concepts/inventory-tech-cards.md` — текущая модель техкарт
- `services/frontend/public/{index.html,style.css,app.js}` — существующие паттерны
- `Wiki/attachments/dikidi/pass2/016_salary_payroll.png` … `019_salary_schemes.png` — как у DIKIDI устроены схемы (можно подглядеть, но повторять 1:1 не цель)

---

_Промпт самодостаточный — содержит контекст проекта, текущее состояние, business-требования, дизайн-конвенции и чёткие deliverables. Вставить в новый чат или передать другому агенту._
