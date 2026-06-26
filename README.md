# samaya

Платформа для бьюти-салона **Самая** (косметология). Внутренняя альтернатива DIKIDI Business: онлайн-запись, журнал записей, расписание мастеров, клиентская CRM, учёт расходников по техкартам услуг.

## Стек

- Node.js + TypeScript (8 сервисов: user, salon, booking, client, inventory, finance, salary, whatsapp)
- PostgreSQL 16 (один инстанс, schema-per-service)
- Redis 7 (кэш / сессии)
- Kong API Gateway (DB-less) + per-route rate-limiting
- Frontend — vanilla JS SPA на nginx
- WhatsApp — whatsapp-web.js через Puppeteer
- Всё через docker-compose

## Структура

```
samaya/
├── docker-compose.yml
├── .env.example          → скопировать в .env
├── kong/kong.yml         API-gateway маршруты
├── database/
│   ├── init/             init-скрипты (схемы, авто-применение миграций)
│   └── migrations/       *.sql — применяются по алфавиту при первом старте
├── services/             микросервисы (Phase 0a)
└── Wiki/                 LLM-вики проекта (Karpathy pattern)
```

Скоуп проекта, архитектурные решения и карта функций — в [`Wiki/index.md`](Wiki/index.md).

## Quickstart

```bash
cp .env.example .env
docker compose up -d
docker compose ps
```

Админка откроется на `http://localhost:${FRONTEND_PORT:-3010}`.

Фронтенд (`services/frontend`) собирается esbuild'ом: исходники в `src/`,
сборка (бандл + минификация + content-hash) в `dist/` — это делает многоступенчатый
Dockerfile при `docker compose build`. Локально без Docker: `cd services/frontend && npm install && npm run build`.

Все сервисы Phase 0a/0b реализованы. Перед продакшен-запуском — см. [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) (секреты, бэкапы, восстановление WhatsApp-сессии).

## Phase plan

- **Phase 0a** — booking core: user, salon, booking, client, frontend (виджет + админка). См. [`Wiki/decisions/2026-04-25-mvp-scope.md`](Wiki/decisions/2026-04-25-mvp-scope.md).
- **Phase 0b** — inventory + tech-cards: автосписание расходников по техкартам услуг. См. [`Wiki/decisions/2026-04-25-inventory-in-mvp.md`](Wiki/decisions/2026-04-25-inventory-in-mvp.md).
- **Phase 1+** — финансы, продажи, зарплата, рассылки. См. ADR-001.

## Документация

Стартовая точка — [`Wiki/index.md`](Wiki/index.md). Открыть `Wiki/` как vault в Obsidian, чтобы видеть граф связей.
