---
type: service
status: stable
last_verified: 2026-04-25
sources:
  - services/user-service/
  - database/migrations/001_users.sql
---

# user-service

Аутентификация, пользователи, компании.

- **Порт**: 3001 (внутри docker network)
- **БД**: PostgreSQL, схема `users`
- **Префикс маршрутов**: `/api/auth/*` (через Kong на `:8010`)

## Ответственность

- Регистрация и логин по email или телефону.
- Выдача access JWT (HS256, default TTL 15m) и opaque refresh-токенов (TTL 30d).
- Ротация refresh-токенов с защитой от replay (`SELECT ... FOR UPDATE` + revoke).
- Хранение SHA256 хеша refresh-токена в БД (сам токен в БД не лежит).
- Master-данные компаний (`users.companies`).

Multi-tenant: каждый user привязан к `company_id`. Уникальность email/phone — в рамках компании. JWT всегда несёт `company_id` и `role` в claims.

## Endpoints

| Метод | Путь | Кто может |
|---|---|---|
| POST | `/api/auth/register` | публично (Phase 0); позже — только админ компании |
| POST | `/api/auth/login` | публично |
| POST | `/api/auth/refresh` | публично, но требует валидного refresh |
| POST | `/api/auth/logout` | публично, требует refresh для revoke |
| GET  | `/api/auth/me` | bearer access JWT |
| GET  | `/health` | внутренний (kubelet/docker healthcheck) |

`company_id` в `register`/`login` опциональный — если не передан, берётся `DEFAULT_COMPANY_ID` из env (для samaya = сидовая компания `00000000-0000-0000-0000-000000000001`).

## Таблицы (схема `users`)

См. `database/migrations/001_users.sql`.

- `companies` — `id (UUID)`, `slug (CITEXT UNIQUE)`, `name`. Сид: `00000000-…001` slug=`samaya`.
- `users` — `id`, `company_id`, `email (CITEXT?)`, `phone?`, `password_hash`, `full_name?`, `role` (`owner|admin|master|client`), `is_active`. Уникальные индексы partial по `(company_id, email)` и `(company_id, phone)`.
- `refresh_tokens` — `id`, `user_id`, `company_id`, `token_hash` (SHA256 hex, UNIQUE), `expires_at`, `revoked_at?`, `ip?`, `user_agent?`.

Триггер `set_updated_at()` на `companies` и `users` обновляет `updated_at`.

## Ключевые архитектурные решения

- **Fail-hard JWT secret в production** (`src/config.ts`): не запустится с дефолтом из `.env.example`. Минимум 32 символа.
- **bcryptjs** (pure-JS), 10 rounds. Не используем native `bcrypt` — упрощает Alpine-сборку.
- **jose** (HS256) для подписи/верификации JWT. Async API, актуальная либа.
- **Refresh rotation**: `refresh()` блокирует строку `FOR UPDATE OF rt`, ревокит старый, выдаёт новый — replay невозможен (см. [[../decisions/2026-04-25-mvp-scope#Архитектурные решения]]).
- **`SET search_path TO users, public`** на каждом новом соединении (`src/db.ts`). public нужен для типов из extensions (citext, uuid-ossp).
- **CORS** — на стороне Kong, не в сервисе. Сервис не светится наружу напрямую.
- **`trust proxy = true`** — Express берёт `X-Forwarded-For` от Kong для `req.ip`.

## Тесты

`src/__tests__/` — vitest. Smoke: refresh-токен/хеш round-trip, JWT sign/verify. Запуск: `cd services/user-service && npm install && npm test`. БД-интеграционные тесты — позже (нужен testcontainers или dedicated test schema).

## Связи

- [[../concepts/dikidi-feature-map]] — даёт контекст по ролям и сегментам пользователей.
- Все остальные сервисы Phase 0 потребляют access JWT через shared auth-middleware (будет в `packages/shared-auth/` — см. ADR-001).
- При создании клиентом записи через виджет `client-service` создаст user с `role=client`, не требуя пароля (или anonymous flow — обсудить в Phase 0a iteration).

## Известные ограничения Phase 0

- Нет recovery: forgot password, magic link, OTP по SMS — Phase 1.
- Нет lockout после N failed login — добавить в Phase 1 (rate-limit на /login через Kong + audit table).
- Нет audit-лога (кто залогинился / создал юзера) — Phase 1.
- `/register` пока публичный для удобства dev. В проде закроется RBAC: только `owner`/`admin` могут создавать `master` и `admin`.
