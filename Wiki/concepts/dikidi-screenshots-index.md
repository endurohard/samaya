---
type: concept
status: stable
last_verified: 2026-04-26
sources:
  - "Wiki/attachments/dikidi/pass1/ — 23 файла, базовый обход (бывший /tmp/dikidi_screenshots/)"
  - "Wiki/attachments/dikidi/pass2/ — 31 файл, углублённый проход по Финансам и Зарплате (бывший /tmp/dikidi_screenshots2/)"
---

# DIKIDI Screenshots Index

Каталог всех 54 скриншотов DIKIDI Business UI компании Samaya (ID 1674757), снятых в рамках двух проходов 2026-04-25/26. Файлы лежат прямо в вики (`Wiki/attachments/dikidi/`) и встроены через Obsidian `![[...|180]]` — открыть полноразмер: клик по миниатюре.

Все факты, выведенные из скринов, законспектированы в:
- [[dikidi-feature-map]] — что есть в каждом модуле
- [[dikidi-finance]] — детальный разбор Финансов
- [[dikidi-extraction-attempts]] — почему не удалось извлечь HTML/JS вместо скриншотов

## Pass 1 — `attachments/dikidi/pass1/` (23 файла)

Базовый обход всех 11 разделов левого меню + несколько модалок.

| Превью | Модуль | Что видно |
|---|---|---|
| ![[attachments/dikidi/pass1/000_00_journal.png\|180]] | Журнал | Главный экран день/мастер-grid с записями, sidebar финансы за день |
| ![[attachments/dikidi/pass1/001_01_schedule.png\|180]] | График | Сетка мастер × день, рабочие интервалы 10:00/20:00 |
| ![[attachments/dikidi/pass1/002_02_clients_list.png\|180]] | Клиенты | Таблица 6963 клиентов, правый сайдбар сегментов |
| ![[attachments/dikidi/pass1/003_02b_clients_add_modal.png\|180]] | Клиенты | Модалка «+ Клиент»: phone, ФИО, ДР, пол, источник |
| ![[attachments/dikidi/pass1/004_02c_client_detail_modal.png\|180]] | Клиенты | Карточка клиента: визиты, средний чек, бонусы, штрафы |
| ![[attachments/dikidi/pass1/005_03_staff.png\|180]] | Мастера | Список сотрудников с ролями (Врач-косметолог, админ и т.п.) |
| ![[attachments/dikidi/pass1/006_04_services.png\|180]] | Услуги | Категории + услуги с прайсом и длительностью |
| ![[attachments/dikidi/pass1/007_05_sales.png\|180]] | Продажи | Журнал продаж, статусы оплаты |
| ![[attachments/dikidi/pass1/008_05b_sales_add_modal.png\|180]] | Продажи | Модалка «Оформить продажу»: услуги + товары + скидки + оплата |
| ![[attachments/dikidi/pass1/009_06_products.png\|180]] | Товары | Список товаров с остатками |
| ![[attachments/dikidi/pass1/010_07_payroll.png\|180]] | Зарплата | Расчёт зарплаты по сотрудникам, период |
| ![[attachments/dikidi/pass1/011_07b_salary.png\|180]] | Зарплата | Детализация начислений |
| ![[attachments/dikidi/pass1/012_08_analytics.png\|180]] | Аналитика | Возвращаемость клиентов, KPI |
| ![[attachments/dikidi/pass1/013_09_finance_menu_expanded.png\|180]] | Финансы | Раскрытое подменю: 5 пунктов |
| ![[attachments/dikidi/pass1/014_09_finance_Доходы_и_Расходы.png\|180]] | Финансы | Главный финансовый экран с donut'ами |
| ![[attachments/dikidi/pass1/015_09_finance_Счета_и_кассы.png\|180]] | Финансы | 3 счёта Samaya с реальными остатками |
| ![[attachments/dikidi/pass1/016_09_finance_Счета_и_кассы_modal.png\|180]] | Финансы | Модалка «+ Счёт/Касса» |
| ![[attachments/dikidi/pass1/017_09_finance_Контрагенты.png\|180]] | Финансы | Список контрагентов: имя + ИНН |
| ![[attachments/dikidi/pass1/018_09_finance_Контрагенты_modal.png\|180]] | Финансы | Модалка «+ Контрагент» |
| ![[attachments/dikidi/pass1/019_09_finance_Кассовые_операции.png\|180]] | Финансы | Лог 54-ФЗ операций |
| ![[attachments/dikidi/pass1/020_10_settings.png\|180]] | Настройки | Главный экран настроек компании |
| ![[attachments/dikidi/pass1/021_11_promotion.png\|180]] | Продвижение | Акции, промокоды |
| ![[attachments/dikidi/pass1/022_12_messages.png\|180]] | Сообщения | Чат-интерфейс с клиентами |

## Pass 2 — `attachments/dikidi/pass2/` (31 файл)

Углублённый проход: все модалки Финансов, все 4 sub-tab'а Зарплаты, развёрнутые подменю Настроек/Продвижения/Товаров.

### Журнал

| Превью | Что видно |
|---|---|
| ![[attachments/dikidi/pass2/000_journal.png\|180]] | Повтор главного экрана для якоря |

### Финансы (001–015) — основа для [[dikidi-finance]]

| Превью | Sub-tab / модалка | Что видно |
|---|---|---|
| ![[attachments/dikidi/pass2/001_finance_cashflow.png\|180]] | Доходы и расходы (день) | KPI-плитка остаток/доход/расход/итог + donut + таблица |
| ![[attachments/dikidi/pass2/002_finance_modal_income.png\|180]] | Модалка «+ Доход» | Поля: счёт, статья, сумма, контрагент, дата, примечание |
| ![[attachments/dikidi/pass2/003_finance_modal_expense.png\|180]] | Модалка «+ Расход» | Те же поля + категория расхода |
| ![[attachments/dikidi/pass2/004_finance_modal_transfer.png\|180]] | Модалка «Перемещение» | Со счёта → на счёт, сумма, дата |
| ![[attachments/dikidi/pass2/005_finance_modal_balance_change.png\|180]] | Модалка «Изменение баланса» | Корректировка остатка вручную |
| ![[attachments/dikidi/pass2/006_finance_cashflow_month.png\|180]] | Доходы и расходы (месяц) | Группировка по дням, KPI за месяц |
| ![[attachments/dikidi/pass2/007_finance_cashflow_year.png\|180]] | Доходы и расходы (год) | Группировка по месяцам |
| ![[attachments/dikidi/pass2/008_finance_accounts.png\|180]] | Счета и кассы | Таблица 3 счетов Samaya: Касса 0.45₽, Расч. счёт 38М, Зухра 203М |
| ![[attachments/dikidi/pass2/009_finance_modal_add_cashbox.png\|180]] | Модалка «+ Касса» | Поля: название, ответственный, остаток |
| ![[attachments/dikidi/pass2/010_finance_modal_add_account.png\|180]] | Модалка «+ Счёт» | Поля + тип счёта (расчётный) |
| ![[attachments/dikidi/pass2/011_finance_account_detail.png\|180]] | Карточка счёта | История операций по конкретному счёту |
| ![[attachments/dikidi/pass2/012_finance_acquiring.png\|180]] | Эквайринг | Настройка POS, выгрузка |
| ![[attachments/dikidi/pass2/013_finance_counterparties.png\|180]] | Контрагенты | Таблица: имя, ИНН, тип |
| ![[attachments/dikidi/pass2/014_finance_counterparty_detail.png\|180]] | Карточка контрагента | История операций с контрагентом |
| ![[attachments/dikidi/pass2/015_finance_cash_operations.png\|180]] | Кассовые операции | 54-ФЗ: документы, статусы, кассир |

### Зарплата (016–019)

| Превью | Sub-tab | Что видно |
|---|---|---|
| ![[attachments/dikidi/pass2/016_salary_payroll.png\|180]] | Расчёт зарплаты | Таблица сотрудников: %, оклад, гарант., к начислению |
| ![[attachments/dikidi/pass2/017_salary_settlements.png\|180]] | Взаиморасчёты | Кто кому должен, сальдо |
| ![[attachments/dikidi/pass2/018_salary_accruals.png\|180]] | Начисления | Журнал начислений с датами |
| ![[attachments/dikidi/pass2/019_salary_schemes.png\|180]] | Схемы расчёта | Конфигурация: Ставка / Ставка+% / % с продаж |

### Прочее (020–030)

| Превью | Модуль | Что видно |
|---|---|---|
| ![[attachments/dikidi/pass2/020_sales_analytics.png\|180]] | Продажи | Аналитика по продажам |
| ![[attachments/dikidi/pass2/021_settings_expanded.png\|180]] | Настройки | Раскрытое подменю настроек |
| ![[attachments/dikidi/pass2/022_settings_profile.png\|180]] | Настройки | Профиль компании |
| ![[attachments/dikidi/pass2/023_settings_services.png\|180]] | Настройки | Управление услугами |
| ![[attachments/dikidi/pass2/024_settings_schedule.png\|180]] | Настройки | Шаблоны расписания |
| ![[attachments/dikidi/pass2/025_settings_notifications.png\|180]] | Настройки | WhatsApp/SMS-нотификации |
| ![[attachments/dikidi/pass2/026_promotion_expanded.png\|180]] | Продвижение | Раскрытое подменю |
| ![[attachments/dikidi/pass2/027_client_detail_page.png\|180]] | Клиенты | Полная страница клиента (не модалка) |
| ![[attachments/dikidi/pass2/028_goods_movements_nav.png\|180]] | Товары | Подменю «Движения товаров» |
| ![[attachments/dikidi/pass2/029_goods_warehouses_nav.png\|180]] | Товары | Подменю «Склады» |
| ![[attachments/dikidi/pass2/030_goods_suppliers_nav.png\|180]] | Товары | Подменю «Поставщики» |

## Pass 3 — `attachments/dikidi/pass3/` (37 файлов)

Третий проход (2026-04-27) — модалки и оставшиеся sub-pages, чего не было в pass1+2. Скриншоты от 30KB фильтровались как 404-страницы. Ключевая находка: **Сообщения = `/owner/chat/`** (не `/messages/`).

### 🏆 Карточка сотрудника DIKIDI — все 8 табов (manual capture, врач Балакеримова Зухра)

Полная карточка с **8 табами**. Эталон для samaya Sprint Step 3.

| Превью | Таб | Что в табе |
|---|---|---|
| ![[attachments/dikidi/pass3/master_card_tab1_profile.png\|180]] | **1. Профиль** | Аватар + Имя*/Фамилия/Должность*/Категория*/Телефон/Email/Сведения. Toggle Работает/Уволен. Checkbox Оказывает услуги. Удалить/Сохранить. |
| ![[attachments/dikidi/pass3/master_card_tab2_schedule.png\|180]] | **2. График** | Inline-расписание: радио «Будни/Все дни/Чётные/Нечётные» + часы 09:00–19:00 + чекбокс Перерыв. Календарь Апреля 2026 с зелёными (рабочими) и красными (выходными) днями. Кнопки Очистить/Сохранить. |
| ![[attachments/dikidi/pass3/master_card_tab3_online_record.png\|180]] | **3. Онлайн-запись** | Toggle «Сотруднику будет доступна онлайн-запись». **Минимальное время до записи** (radios 1ч/2ч/4ч/8ч/12ч/24ч/следующий день). **Оптимальное время записи** (toggle). **Фиксированное время** (toggle, по дням недели + параметры). |
| ![[attachments/dikidi/pass3/master_card_tab4_services.png\|180]] | **4. Услуги** | Список услуг которые мастер оказывает (поиск + фильтр по категории + кнопка «+ Добавить услугу»). 9 строк: ID/Длительность/Цена/Скидка/Онлайн-toggle. Зухра: INMODE MORPHEUS 8 60K, Архитектура лица 20K, Биоревитализация 10/18K, Боди Тайт 50K, BOTOX… |
| ![[attachments/dikidi/pass3/master_card_tab5_salary_schemes.png\|180]] | **5. Схемы ЗП** | Empty state «Ничего не найдено» + кнопка «+ Добавить схему». Колонки: Название схемы / Дата начала действия. |
| ![[attachments/dikidi/pass3/master_card_tab6_access.png\|180]] | **6. Доступ** | Toggle «Доступ к проекту» (active). Мобильный номер +79604080333. Группа пользователей «Создатель» (dropdown). Ссылка «Полные права доступа». Кнопка Сохранить доступ. |
| ![[attachments/dikidi/pass3/master_card_tab7_photo_work.png\|180]] | **7. Фото работ** | Drag-zone «Добавить фото» с иконкой ↓. Галерея для портфолио мастера. |
| ![[attachments/dikidi/pass3/master_card_tab8_notifications.png\|180]] | **8. Оповещения** | Toggle «Получать SMS-оповещения». Toggle «Получать E-mail оповещения». |

### 🏆 Booking detail modal — «Изменение записи»

| Превью | Что видно |
|---|---|
| ![[attachments/dikidi/pass3/booking_detail_modal_real.png\|180]] | Модалка существующей записи: Мастер (Курбанова Жасмина) / Дата (27.04.2026) / Время (11:00). Таблица услуг (Лазерная эпиляция 3D × 2 строки, Длит/Цена/Скидка/Итого). Дополнительно textarea. Промокод. Toggle «Прибавить время». Клиент (Сандова Айна) с историей записей. Источник записи / Промокод / Напоминание (за 1 час / Не отправлять). **Цвет записи** color-picker (8 цветов). Toggle «Имеет анализы по клиенту…». **Итого 1000.00 / Оплачено 1000.00 / Долг 0.00**. Кнопки: «Перейти к продаже» / **«Отменить запись»** / **«Повторить запись»** / **«Сохранить»**. |

### 💰 Раздел Продажи DIKIDI — все периоды + раскрытая строка

| Превью | Период | Что видно |
|---|---|---|
| ![[attachments/dikidi/pass3/sales_period_today.png\|180]] | Сегодня | Оборот 1 000.00₽ / Себестоимость 200.00 / Прибыль 800.00₽ (80%). 1 продажа: Сандова Айна 1000₽ |
| ![[attachments/dikidi/pass3/sales_period_week.png\|180]] | Неделя | 1 750 000.00₽ / 13 000.00 / 1 737 000.00 (99.26%). 4 продажи. |
| ![[attachments/dikidi/pass3/sales_period_month.png\|180]] | Месяц | 18 127 101.00₽ / 148 020.20 / 17 979 080.80 (99.18%) |
| ![[attachments/dikidi/pass3/sales_period_year.png\|180]] | Год | **101 409 401.00₽** / 1 008 330.20 / **100 401 070.80** (99.01%) |
| ![[attachments/dikidi/pass3/sales_row_expanded.png\|180]] | Раскрытая строка | Детализация продажи: Услуги (Сандова Айна 1000₽), Сотрудник (Курбанова Жасмина), Расходы 200₽, Зарплата 800₽, Прибыль 800₽ (80%). Itого row внизу. |

### ⭐ Edit-карточки (Pass 12) — модалки редактирования через клик на строку

Эти захвачены через Playwright Locator API (симулирует реальные mouse-события). **Главное достижение** — карточка сотрудника со всеми 7 табами.

| Превью | Что видно |
|---|---|
| ![[attachments/dikidi/pass3/000_master_modal_profile_tab.png\|180]] | **Карточка сотрудника DIKIDI — Профиль таб (active)** ⭐⭐⭐. Оказалось не 4, а **7 табов**: Профиль / График / Онлайн-запись / Услуги / Схемы ЗП / Доступ / Фото работ / Оповещения. Все поля: Имя*/Фамилия/Должность*/Категория*/Телефон/Email/Сведения о сотруднике + аватар + toggle Работает/Уволен + checkbox Оказывает услуги + кнопки «Удалить сотрудника»/«Сохранить профиль» |
| ![[attachments/dikidi/pass3/001_master_modal_график_tab.png\|180]] | Таб «График» — расписание сотрудника inline в модалке |
| ![[attachments/dikidi/pass3/002_master_modal_схемы_зп_tab.png\|180]] | Таб «Схемы ЗП» — список схем расчёта зарплаты для конкретного сотрудника |
| ![[attachments/dikidi/pass3/003_master_modal_доступ_tab.png\|180]] | Таб «Доступ» — права/роли сотрудника в системе |
| ![[attachments/dikidi/pass3/004_service_edit_modal_real.png\|180]] | **Модалка редактирования услуги** — полная форма с категорией/ценой/длительностью/цветом |
| ![[attachments/dikidi/pass3/005_client_detail_modal_real.png\|180]] | **Карточка клиента** — детальный вид с историей визитов |
| ![[attachments/dikidi/pass3/006_sale_wizard_open.png\|180]] | Sale Wizard — расширенный вид (открыт через клик «Добавить продажу») |
| ![[attachments/dikidi/pass3/master_modal_admin_4tabs.png\|180]] | **Карточка администратора** (Тагирова Джамиля) — у admin-роли **только 4 таба** (Профиль/График/Схемы ЗП/Доступ), у врача-косметолога 7+. Количество табов = функция роли. |
| ![[attachments/dikidi/pass3/journal_past_week_view.png\|180]] | Журнал записей DIKIDI неделю назад — пустой (записей не было) |

### Эталонные референсы — полный левый сайдбар DIKIDI и Sale Wizard

| Превью | Что видно |
|---|---|
| ![[attachments/dikidi/pass3/journal_full_sidebar.png\|180]] | **Эталон** — Журнал с полным сайдбаром DIKIDI: 12 пунктов меню (Журнал/График/Клиенты/Продвижение/Сообщения/Зарплата/Продажи/Финансы/Товары/Настройки/Тариф/Поддержка) + правый виджет «Финансы за сегодня» |
| ![[attachments/dikidi/pass3/clients_full_subnav.png\|180]] | **Эталон** — Клиенты с полным sub-nav: Список / Возвращаемость / Бонусная программа / Рассылка / Звонки / Сертификаты / Чаевые / Отзывы / Штрафы. Правый сайдбар сегментов (VIP 247, Спящие 1058, Заблокированные 1, Штрафники 4) |
| ![[attachments/dikidi/pass3/sale_wizard_modal.png\|180]] | **Модалка «Оформить продажу»** (holy grail) — заголовок «Продажа товаров и услуг от 27.04.2026 в 09:11», 3 таба (Услуги/Товары/Сертификаты), грид-строка (Исполнитель/Услуги/Длит/Материалы/Цена/Скидка %/Скидка ∑/Итого + кнопка ⊕), нижняя строка «Начислено / Итого к оплате», кнопки «Перейти к оплате» / «Сохранить» |

### Финансы — полный layout с правильным URL `/owner/biz_cashflow/`

Pass 7 нашёл правильный URL: **`/owner/biz_cashflow/`** (а не `/owner/cashflow/`). 5 эталонных скринов по всем 5 sub-tab Финансов:

| Превью | Sub-tab | Что видно |
|---|---|---|
| ![[attachments/dikidi/pass3/finance_full_dashboard.png\|180]] | Доходы и Расходы | Полный layout: period pills (Сегодня/Вчера/Неделя/Месяц/Год), 4 KPI с donut'ами (Остаток начало 243М / Доходы / Расходы / Остаток конец), кнопки Доход/Расход/Перемещение/Фильтры/Печать/**Изменение остатков**, таблица с колонками Тип/Счёт/Получатель/Статья движения/Сумма/Примечание/Создано |
| ![[attachments/dikidi/pass3/finance_full_accounts.png\|180]] | Счета и кассы | Список счетов Samaya: Касса 0.45₽, Расч. счёт 38М, Зухра 203М с реальными остатками |
| ![[attachments/dikidi/pass3/finance_full_acquiring.png\|180]] | Эквайринг | Настройки POS-терминалов и онлайн-эквайринга |
| ![[attachments/dikidi/pass3/finance_full_counterparties.png\|180]] | Контрагенты | Список контрагентов с ИНН/типом, открыта детальная карточка |
| ![[attachments/dikidi/pass3/finance_full_cash_operations.png\|180]] | Кассовые операции | 54-ФЗ документы, статусы фискализации |

### Полный набор по реальным URL'ам (Pass 9 — DOM-discovery)

После DOM-дампа всех `/owner/` ссылок в pass 8 — точечно по 29 настоящим URL DIKIDI.
**Карта URL'ов сохранена** в `/tmp/dikidi_owner_urls.json`.

#### Клиенты sub-tabs (правильные URL вместо догадок)

| Превью | URL | Что видно |
|---|---|---|
| ![[attachments/dikidi/pass3/000_clients_retention.png\|180]] | `/owner/retention/` | **Возвращаемость** — RFM аналитика по мастерам |
| ![[attachments/dikidi/pass3/001_clients_bonuses_program.png\|180]] | `/owner/bonuses/` | **Бонусная программа** — настройки начисления |
| ![[attachments/dikidi/pass3/002_clients_calls_ats.png\|180]] | `/owner/ats/` | **Звонки** — лог входящих/исходящих, ATS-интеграция |
| ![[attachments/dikidi/pass3/003_clients_certificates_templates.png\|180]] | `/owner/certificates/templates/` | **Сертификаты** — шаблоны подарочных сертификатов |

#### Зарплата — все 4 sub-tab DIKIDI

| Превью | URL | Что видно |
|---|---|---|
| ![[attachments/dikidi/pass3/004_salary_payroll.png\|180]] | `/owner/payroll/` | **Расчёт зарплаты** — таблица сотрудников за период |
| ![[attachments/dikidi/pass3/005_salary_settlements.png\|180]] | `/owner/salaryMutualSettlements/` | **Взаиморасчёты** — кто кому должен, сальдо |
| ![[attachments/dikidi/pass3/006_salary_sheets.png\|180]] | `/owner/salarySheets/` | **Начисления** — журнал ведомостей |
| ![[attachments/dikidi/pass3/007_salary_schemes_full.png\|180]] | `/owner/salarySchemes/` | **Схемы расчёта** — список схем по мастерам |

#### Финансы — Эквайринг/Контрагенты/Кассы (правильные URL без `biz_`)

| Превью | URL | Что видно |
|---|---|---|
| ![[attachments/dikidi/pass3/008_finance_cashbox_full.png\|180]] | `/owner/biz_cashbox/` | Счета и кассы — детальный |
| ![[attachments/dikidi/pass3/009_finance_acquiring_real.png\|180]] | `/owner/acquiring/` | Эквайринг (URL без `biz_`!) |
| ![[attachments/dikidi/pass3/010_finance_counterparties_real.png\|180]] | `/owner/counterparties/` | Контрагенты (URL без `biz_`) |
| ![[attachments/dikidi/pass3/011_finance_cash_operations_real.png\|180]] | `/owner/cashequipment/` | **Кассовые операции** (URL `cashequipment`!) |

#### Настройки — все 9 sub-pages

| Превью | URL | Что видно |
|---|---|---|
| ![[attachments/dikidi/pass3/012_settings_company_profile.png\|180]] | `/owner/profile/` | **Профиль компании** ⭐ — название, адрес, часы работы, лого |
| ![[attachments/dikidi/pass3/013_settings_masters_employees.png\|180]] | `/owner/masters/` | Сотрудники (URL `masters` не `staff`!) |
| ![[attachments/dikidi/pass3/014_settings_services_full.png\|180]] | `/owner/services/` | Услуги — управление |
| ![[attachments/dikidi/pass3/015_settings_widget_online_record.png\|180]] | `/owner/propertiesOfOnlineRecord/` | **Виджет онлайн-записи** ⭐ — настройки публичного widget'а |
| ![[attachments/dikidi/pass3/016_settings_permissions_access.png\|180]] | `/owner/permissions/` | **Доступ к проекту** ⭐ — роли и права |
| ![[attachments/dikidi/pass3/017_settings_integrations_full.png\|180]] | `/owner/integration/type/` | **Интеграции** ⭐ — WhatsApp/SMS/Telegram/Telephony — большой 520KB скрин |
| ![[attachments/dikidi/pass3/018_settings_payment_account.png\|180]] | `/owner/payment/` | **Лицевой счёт** — баланс DIKIDI, история платежей |
| ![[attachments/dikidi/pass3/019_settings_alerts_notifications.png\|180]] | `/owner/alerts/` | Оповещения — внутренние нотификации |
| ![[attachments/dikidi/pass3/020_settings_resources.png\|180]] | `/owner/resources/` | Ресурсы (кабинеты, оборудование) |

#### Продажи / Аналитика / Товары / Продвижение / Журнал

| Превью | URL | Что видно |
|---|---|---|
| ![[attachments/dikidi/pass3/021_analytics_sales_full.png\|180]] | `/owner/analytics/sales/` | **Аналитика продаж** — графики по периодам |
| ![[attachments/dikidi/pass3/022_goods_flow_movements.png\|180]] | `/owner/products_flow/` | Движения товаров (URL `products_flow`!) |
| ![[attachments/dikidi/pass3/023_goods_stock_warehouses.png\|180]] | `/owner/biz_stock/` | Склады |
| ![[attachments/dikidi/pass3/024_promo_shares.png\|180]] | `/owner/shares/` | **Акции** ⭐ 1.2MB — большая страница со списком акций |
| ![[attachments/dikidi/pass3/025_promo_premium.png\|180]] | `/owner/premium/` | Премиум-подписка |
| ![[attachments/dikidi/pass3/026_promo_referral_offer.png\|180]] | `/owner/referral_offer/` | Реферальная программа |
| ![[attachments/dikidi/pass3/027_journal_groups.png\|180]] | `/owner/journal/groups/` | **Журнал групповых записей** |
| ![[attachments/dikidi/pass3/028_notifications_statistic.png\|180]] | `/owner/notifications/statistic/` | Статистика уведомлений |

### Клиенты sub-tabs — все 7 рабочих табов

Pass 6 кликом по тексту захватил вкладки внутри страницы:

| Превью | Sub-tab | Что видно |
|---|---|---|
| ![[attachments/dikidi/pass3/clients_возвращаемость_after.png\|180]] | Возвращаемость | RFM аналитика: новые/вернувшиеся/потерянные клиенты по мастерам |
| ![[attachments/dikidi/pass3/clients_бонусная_программа_after.png\|180]] | Бонусная программа | Настройки начисления/списания бонусов |
| ![[attachments/dikidi/pass3/clients_рассылка_after.png\|180]] | Рассылка | Список WhatsApp/SMS-рассылок (status, время, получатели) |
| ![[attachments/dikidi/pass3/clients_звонки_after.png\|180]] | Звонки | Лог звонков с записями |
| ![[attachments/dikidi/pass3/clients_чаевые_after.png\|180]] | Чаевые | Учёт чаевых мастерам |
| ![[attachments/dikidi/pass3/clients_отзывы_after.png\|180]] | Отзывы | Отзывы клиентов с модерацией |
| ![[attachments/dikidi/pass3/clients_штрафы_after.png\|180]] | Штрафы | No-show / опоздания, начисления штрафов |
| ![[attachments/dikidi/pass3/client_detail_open.png\|180]] | Клиент детально | Полная страница карточки клиента |

### Журнал, График, Услуги (модалки)

| Превью | Что видно |
|---|---|
| ![[attachments/dikidi/pass3/000_journal_main.png\|180]] | Журнал главный (актуальная день-сетка) |
| ![[attachments/dikidi/pass3/001_journal_add_modal.png\|180]] | Модалка «+ Добавить запись» — поля клиент/услуги/мастер/дата |
| ![[attachments/dikidi/pass3/002_schedule_main.png\|180]] | График работы — сетка месяц × мастера |
| ![[attachments/dikidi/pass3/012_services_list.png\|180]] | Услуги — таблица с категориями и ценами |
| ![[attachments/dikidi/pass3/013_services_add_modal.png\|180]] | Модалка «+ Услуга» — все поля DIKIDI (название, цена, длительность, цвет, категория) |
| ![[attachments/dikidi/pass3/014_services_category_modal.png\|180]] | Модалка «+ Категория услуг» |

### Клиенты — sub-tabs (5 из 8 удалось снять)

| Превью | Sub-tab | Что видно |
|---|---|---|
| ![[attachments/dikidi/pass3/005_clients_mailing_list.png\|180]] | Рассылка | Список рассылок: имя, тип, статус, время |
| ![[attachments/dikidi/pass3/006_clients_calls_log.png\|180]] | Звонки | Лог входящих/исходящих с записями |
| ![[attachments/dikidi/pass3/007_clients_certificates.png\|180]] | Сертификаты | Подарочные сертификаты — продажа/использование |
| ![[attachments/dikidi/pass3/008_clients_tips.png\|180]] | Чаевые | Учёт чаевых мастерам |
| ![[attachments/dikidi/pass3/009_clients_reviews.png\|180]] | Отзывы | Сбор и модерация |
| ![[attachments/dikidi/pass3/010_clients_fines.png\|180]] | Штрафы | No-show / опоздания |
| ![[attachments/dikidi/pass3/011_clients_mailing_create_modal.png\|180]] | Модалка «Создать рассылку» | Wizard рассылки |

### Продажи (модалка create)

| Превью | Что видно |
|---|---|
| ![[attachments/dikidi/pass3/017_sales_list.png\|180]] | Продажи — журнал с статусами оплаты |
| ![[attachments/dikidi/pass3/018_sales_create_step1.png\|180]] | Модалка «Оформить продажу» step 1 — выбор клиента/услуг/товаров |

### Товары (модалки и sub-pages)

| Превью | Что видно |
|---|---|
| ![[attachments/dikidi/pass3/019_goods_list.png\|180]] | Товары — список с остатками |
| ![[attachments/dikidi/pass3/020_goods_add_modal.png\|180]] | Модалка «+ Товар» — все поля |
| ![[attachments/dikidi/pass3/021_goods_receipt_modal.png\|180]] | Модалка «Поступление товара» |
| ![[attachments/dikidi/pass3/024_goods_suppliers.png\|180]] | Поставщики (sub-page) |
| ![[attachments/dikidi/pass3/goods_movements.png\|180]] | Движения товаров |
| ![[attachments/dikidi/pass3/goods_warehouses.png\|180]] | Склады |
| ![[attachments/dikidi/pass3/goods_suppliers.png\|180]] | Поставщики (через сайдбар) |

### Зарплата (модалка create)

| Превью | Что видно |
|---|---|
| ![[attachments/dikidi/pass3/025_salary_main.png\|180]] | Зарплата главная (Расчёт) |
| ![[attachments/dikidi/pass3/026_salary_scheme_modal.png\|180]] | Модалка «+ Схема» — radio типы (Ставка / Ставка+% / %), поля раскрываются динамически |

### Продвижение и виджет

| Превью | Что видно |
|---|---|
| ![[attachments/dikidi/pass3/promotion_main_page.png\|180]] | Продвижение — главная (акции) |
| ![[attachments/dikidi/pass3/027_promo_actions.png\|180]] | Акции — список и фильтры |
| ![[attachments/dikidi/pass3/030_promo_widget.png\|180]] | Виджет онлайн-записи — настройки |

### Сообщения

| Превью | Что видно |
|---|---|
| ![[attachments/dikidi/pass3/messages_main.png\|180]] | Сообщения — список диалогов (URL `/owner/chat/`) |
| ![[attachments/dikidi/pass3/messages_chat_thread.png\|180]] | Открытый чат с клиентом — история переписки |

### Настройки (3 sub-pages)

| Превью | Sub-page | Что видно |
|---|---|---|
| ![[attachments/dikidi/pass3/034_settings_notifications_full.png\|180]] | Уведомления | Полный экран настройки WA/SMS-правил |
| ![[attachments/dikidi/pass3/037_settings_payments.png\|180]] | Платежи | Настройка эквайринга/онлайн-оплат |
| ![[attachments/dikidi/pass3/038_settings_templates.png\|180]] | Шаблоны | Шаблоны сообщений клиентам |

### Прочее

| Превью | Что видно |
|---|---|
| ![[attachments/dikidi/pass3/extensions_pricing.png\|180]] | Тарифный план DIKIDI |
| ![[attachments/dikidi/pass3/support_center.png\|180]] | Центр поддержки |

## Не удалось снять (404 / нет URL)

Sub-tabs которые в DIKIDI существуют как **табы внутри страницы**, не как отдельные URL:
- Клиенты → Возвращаемость, Бонусная программа (есть в feature-map, но рендерятся в main content area страницы /clients/)
- Настройки → Профиль компании, Виджет онлайн-записи, Доступ/Роли, Интеграции (sub-URL'ы возвращают 404 без активной сессии раздела)
- Журнал → «Оформить продажу» (требует выбранную запись)
- Мастера → «+ Сотрудник» modal (sidebar клик не сработал из-за DIKIDI's collapsed-sidebar в новой версии)
- Финансы → Filter drawer, Изменение остатков modal (drawer был заблокирован cookie-overlay)

Для полного покрытия этих экранов — нужен ручной обход в реальном Chrome с авторизованной сессией (Playwright headless detection блокирует часть UI).

## Группировка по модулям samaya

| Модуль samaya | Pass 1 | Pass 2 | Pass 3 |
|---|---|---|---|
| Журнал | 000 | 000 | 000–001 |
| Расписание | 001 | 024 | 002 |
| Клиенты | 002–004 | 027 | 005–011 (5 sub-tabs + рассылка modal) |
| Услуги | 006 | 023 | 012–014 (+ category modal) |
| Мастера | 005 | — | — |
| Продажи | 007–008 | 020 | 017–018 (sale wizard step1) |
| Товары | 009 | 028–030 | 019–021, 024 + 3 sidebar nav (modals + поставщики/склады) |
| Зарплата | 010–011 | 016–019 | 025–026 (+ scheme modal) |
| Финансы | 013–019 | 001–015 | — |
| Настройки | 020 | 021–025 | 034, 037–038 (notifications/платежи/шаблоны) |
| Продвижение | 021 | 026 | 027, 030 (+ promotion main + виджет) |
| Сообщения | 022 | — | messages_main + thread |
| Аналитика | 012 | — | — |
| Тариф/Поддержка | — | — | extensions, support |
