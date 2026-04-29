---
type: concept
status: stable
last_verified: 2026-04-26
sources:
  - "/tmp/dikidi_*.js — 59 Playwright-скриптов попыток извлечения"
  - "/tmp/dikidi_full/ — частичные артефакты HTML/JSON"
  - "/tmp/dikidi_forms/, /tmp/dikidi_forms2/, /tmp/dikidi_forms3/ — попытки AJAX-скрапинга"
---

# DIKIDI Extraction Attempts

«Что мы пробовали, что сработало, что нет». Эта страница нужна, чтобы будущий агент **не повторял** заведомо безуспешные попытки скрапинга dikidi.ru.

TL;DR: **скриншоты — единственный надёжный артефакт**. См. [[dikidi-screenshots-index]] и [[dikidi-finance]]. Любая попытка получить HTML/JS бэкенда DIKIDI через Playwright блокируется. Пересъёмка — только через реальный браузер с авторизованной сессией.

## Что сработало

| Метод | Результат | Артефакт |
|---|---|---|
| Скриншоты в реальном браузере (пользователь сам делал) | 54 PNG, охватывают все 11 модулей + ключевые модалки | `/tmp/dikidi_screenshots/`, `/tmp/dikidi_screenshots2/` |
| Визуальный анализ скриншотов агентом | Извлечены все факты в [[dikidi-feature-map]], [[dikidi-finance]] | этот wiki |

## Что не сработало (и почему)

### 1. Bot-protection блокирует Playwright

DIKIDI выдаёт `js-challenge-script` (CloudFlare-подобный) и проверяет ответ через `js-challenge-validation` endpoint. Признаки:
- User-agent с `HeadlessChrome` → 403 / blocked-страница.
- User-agent с `Playwright` → то же.
- Даже с подменой UA на свежий Chrome — multiple-challenge: cookie-баннер + капча на ряде маршрутов.

**Симптом в артефактах**: 7 файлов в `/tmp/dikidi_full/bundles/` (script_0…script_6) весят ~3520 байт каждый — это placeholder с challenge-кодом, не реальный JS-бандл. Только `script_3_i18next.min.js` и `script_4_i18nextHttpBackend.min.js` — настоящие (это публичные CDN-библиотеки, отдаются всем).

### 2. Login через `/ru/login/` — 404

Прямой POST на `/ru/login/` возвращает 404. Login-флоу DIKIDI:
1. На главной странице (`beauty.dikidi.net`) JS вызывает `sw.auth.modal()`.
2. Модалка авторизации монтируется поверх главной.
3. По умолчанию выбрана **Bulgaria (+359)** в country-code dropdown — нужно сменить на Россию (+7) перед вводом телефона.
4. Поверх формы висит **cookie-consent overlay**, который перехватывает клики — нужно сначала закрыть его.
5. После submit — POST на `auth.dikidi.net/api/...`, возвращает session cookie.
6. Редирект на `dikidi.net/ru/owner/` (owner-панель).

**Граблей**: Bulgaria-default + cookie-overlay + капча после нескольких неудачных попыток. Во всех 59 скриптах в `/tmp/dikidi_*.js` есть итерации обхода каждого из этих шагов; в итоге работающего полного автологина не получилось.

### 3. AJAX-скрапинг форм — почти всё пустое

Папка `/tmp/dikidi_forms/`:
- 33 файла `*_raw.json` + `*_fields.json`
- В `*_raw.json` обычно `{"error": "Это не AJAX запрос"}` (97 байт) — DIKIDI требует `X-Requested-With: XMLHttpRequest` + специфичные сессионные токены, которые мы не смогли подделать.
- `all_ajax_responses.json` — лог всех попыток.

Папка `/tmp/dikidi_forms2/`:
- Один файл `ajax_log.json` — повторение того же.

Папка `/tmp/dikidi_forms3/`:
- 11 HTML-файлов модалок (cashbox, cashflow_income, client_add, …) — **все 6195 байт каждый, идентичные**. На самом деле это закэшированный модал «отправить нотификацию» — не то что заявлено в имени файла. Сервер вернул один и тот же placeholder для всех запросов.

### 4. Sections — почти все вернули login HTML

`/tmp/dikidi_full/sections/` — 20 директорий по разделам (journal, schedule, clients, finance_*, salary_*, goods_*, settings_*, sales, messages). В каждой — копия HTML главной страницы с login-модалкой, потому что Playwright-сессия слетела до этих запросов.

Полезного контента нет; директории служат напоминанием, что путь «обойти всё через Playwright» провалился.

### 5. JS-бандлы — заглушки

`/tmp/dikidi_full/js_bundle_urls.json` — список всех `<script src=…>` с главной. Скачались только аналитики (Google, Yandex.Metrica, VK pixel). Реальные `sw.*` фреймворковые JS-файлы DIKIDI не отдаются без сессии.

### 6. VK.ru в трейсах

При исследовании сетевых запросов появлялись вызовы на `vk.ru` и `vk.com`. Это **VK Retargeting pixel** (`VK-RTRG-467097-hSv3t`), загружается через VK SDK для рекламной аналитики. К функционалу DIKIDI не относится.

## Эволюция попыток (хронология)

В `/tmp/` лежат **59 файлов** `dikidi_*.js` — итерации Playwright-скриптов. Хронологически (по namings):

1. `dikidi_explore.js`, `dikidi_base.js` — первая разведка
2. `dikidi_login.js`, `dikidi_business_login.js`, `dikidi_correct_login.js`, `dikidi_complete_login.js`, `dikidi_final_login.js` — попытки автологина (5+ итераций)
3. `dikidi_auth_final.js`, `dikidi_biz_auth.js`, `dikidi_debug_auth.js`, `dikidi_direct_auth.js` — обход bot-protection
4. `dikidi_direct_ajax.js`, `dikidi_dynamic.js` — AJAX-fallback
5. `dikidi_fetch_forms.js`, `dikidi_fetch_forms2.js` — попытки забрать модалки форм
6. `dikidi_finance_full.js`, `dikidi_extract_pass2.js` — финальные комбайны
7. `dikidi_comprehensive.js`, `dikidi_final.js`, `dikidi_final2.js` — последние «универсальные» обёртки

Каждый следующий скрипт пытался обойти грабли предыдущего; ни один не дал полного покрытия. См. список через `ls /tmp/dikidi_*.js`.

## Стек DIKIDI (что удалось понять из открытых артефактов)

- **jQuery 1.11.1** + кастомный фреймворк `sw` (НЕ React/Vue/Quasar — обычный MPA с server-side rendering)
- **Bootstrap 3** custom themed
- **Handlebars** templates server-side
- **Riot.js** для интерактивных тегов (форма записи использует `journal-record-master`, `journal-record-service-item`)
- **PushStream.js** — WebSocket real-time через `query.dikidi.net`
- **i18next** (ru/en/kk локали) — конфигурируется inline-скриптом, см. `/tmp/dikidi_full/inline_scripts.json`
- **PHP backend** (server-rendered HTML, AJAX-фрагменты через `sw.result()` → `sw.apply()`)
- Без webpack/vite — конкатенация JS/CSS с `?v=…` querystring

Подробнее — [[dikidi-feature-map#Техническая реализация DIKIDI]].

## Рекомендации будущему агенту

1. **Не пытаться повторить Playwright-скрапинг** — потратите 4+ часа без результата.
2. Если нужны новые экраны DIKIDI — попросить владельца сделать скриншоты руками. Это 5 минут.
3. Если *обязательно* нужен HTML/JS — открыть DIKIDI в реальном Chrome под пользователем, в DevTools → Application → скопировать все cookies, передать их в `curl` с правильными `X-Requested-With: XMLHttpRequest` и `Referer`. Сессионные cookies живут ~12 часов.
4. Все факты, которые удалось вытащить, уже сконденсированы в:
   - [[dikidi-feature-map]] — структура и бизнес-факты
   - [[dikidi-finance]] — детальный модуль Финансы
   - [[dikidi-screenshots-index]] — карта артефактов
5. Эти 3 страницы + папки `/tmp/dikidi_screenshots*/` — единственное, что нужно сохранить. Остальные `/tmp/dikidi_*` можно удалить без потери знаний.
