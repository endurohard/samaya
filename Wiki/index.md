# Wiki Index

Каталог всех страниц. Обновляется при каждом ingest.

## Meta
- [[AGENTS]] — схема вики (правила ingest/query/lint)
- [[log]] — хронология операций
- [[sources]] — карта raw-sources → страницы

## Concepts
- [[concepts/dikidi-feature-map]] — полная карта функций dikidi.ru как референса для samaya
- [[concepts/dikidi-finance]] — детальный разбор модуля Финансы (5 sub-tab, 5 модалок, реальные счета Samaya)
- [[concepts/dikidi-screenshots-index]] — каталог 54 скриншотов DIKIDI с привязкой к модулям
- [[concepts/dikidi-extraction-attempts]] — что пробовали скрапить и почему не вышло (для будущих агентов)
- [[concepts/inventory-tech-cards]] — учёт расходников + автосписание по техкартам услуг

## Decisions / Audits
- [[decisions/2026-04-25-mvp-scope]] — ADR-001: scope Phase 0 MVP, отложенные модули, архитектурные правила
- [[decisions/2026-04-25-inventory-in-mvp]] — ADR-002: бамп inventory + tech-cards в Phase 0 (двухэтапная 0a/0b)
- [[decisions/2026-04-25-clients-segments-in-mvp]] — ADR-003: client-service + сегменты на лету в Phase 0a
- [[decisions/2026-07-13-security-correctness-audit]] — Аудит корректности/безопасности: ~30 находок (бонусы, poison event, двойная выплата ЗП, RBAC fail-closed, TZ) → PR #1

## Services
- [[services/user-service]] (3001) — auth, пользователи, компании, роли — **готов**
- [[services/salon-service]] (3002) — категории, услуги, мастера, расписание + публичные эндпоинты — **готов**
- [[services/booking-service]] (3003) — слоты, записи, lifecycle, outbox + публичный booking — **готов**
- [[services/client-service]] (3004) — клиенты салона, сегменты на лету (постоянные/спящие/пропавшие/новые) — **готов**
- [[services/inventory-service]] (3005) — расходники, FIFO-партии, техкарты, автосписание (Phase 0b) — **готов**
- [[services/frontend-service]] — admin SPA на nginx + ваниль JS (порт 3010) — **готов**
