# Деплой и эксплуатация samaya

Чеклист и процедуры для продакшен-запуска. Связано с [[README]] и Wiki ADR.

## 1. Секреты (обязательно перед запуском)

Скопировать `.env.example` → `.env` и заменить все дефолты. Сервисы с `NODE_ENV=production`
**откажутся стартовать** с дефолтными значениями (fail-hard в `config.ts` / `auth.js`):

| Переменная | Требование | Как сгенерировать |
|---|---|---|
| `JWT_SECRET` | ≥ 32 байт, общий для всех сервисов | `openssl rand -base64 48` |
| `POSTGRES_PASSWORD` | сильный | `openssl rand -base64 24` |
| `WHATSAPP_INTERNAL_TOKEN` | сильный, service-to-service | `openssl rand -hex 32` |
| `SMTP_HOST/PORT/USER/PASS/FROM` | реальный SMTP (не Mailhog) | у провайдера |
| `NODE_ENV` | `production` | — |
| `FRONTEND_URL` | публичный https-URL | — |

`.env` в `.gitignore` — не коммитить.

## 2. Сеть и TLS

- Postgres/Redis не публикуются на хост (`expose`, не `ports`) — доступ только внутри `samaya-network`.
- HTTPS терминируется на внешнем reverse-proxy (nginx/Caddy/Traefik) перед `frontend-service`.
  Проксировать `:80` контейнера фронта, добавить редирект 80→443 и HSTS на уровне внешнего прокси.
- CSP/`X-Content-Type-Options`/`Referrer-Policy` уже отдаёт `frontend/security-headers.conf`.
- Rate-limiting на `/api/auth/login` (10/мин), `/api/bookings/public` (30/мин),
  `/api/clients/portal` (60/мин) — в `kong/kong.yml`.

## 3. Запуск

```bash
cp .env.example .env && $EDITOR .env   # заменить секреты
docker compose up -d --build
docker compose ps                      # дождаться (healthy) у всех
```

Миграции БД применяются автоматически из `database/migrations/` **только при первой
инициализации** тома `postgres_data` (через `database/init/`). Для уже существующей БД
новую миграцию применять вручную:

```bash
docker exec -i samaya-postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -v ON_ERROR_STOP=1 < database/migrations/0XX_name.sql
```

## 4. Бэкапы PostgreSQL

Скрипт [`scripts/backup-db.sh`](../scripts/backup-db.sh) — `pg_dump -Fc` + ротация (по умолчанию 14 дней)
+ проверка целостности дампа.

```bash
./scripts/backup-db.sh                 # ручной прогон → backups/samaya_<дата>.dump
```

Cron (ежедневно 03:30):

```cron
30 3 * * * /path/to/samaya/scripts/backup-db.sh >> /var/log/samaya-backup.log 2>&1
```

**Восстановление** (перезапишет данные!):

```bash
docker exec -i samaya-postgres pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  --clean --if-exists < backups/samaya_<дата>.dump
```

## 5. WhatsApp-сессия

- `whatsapp-service` хранит сессию в томе `whatsapp_session` (`/data/session`).
- Первичная авторизация: открыть админку → раздел сообщений → отсканировать QR
  (endpoint `/api/whatsapp/qr` защищён JWT админа).
- `WHATSAPP_TEST_MODE=true` (дефолт) — отправки не уходят реально; в проде ставить `false`.
- При потере сессии (разлогин на телефоне) — повторить скан QR. Перезапуск браузера:
  кнопка «Перезапустить» в админке или `POST /api/whatsapp/restart`.
- Том `whatsapp_session` тоже стоит бэкапить (`docker run --rm -v samaya_whatsapp_session:/d -v $PWD:/b alpine tar czf /b/wa_session.tgz -C /d .`).

## 6. Ресурсы и рестарты

- `docker-compose.yml` задаёт `mem_limit`/`cpus` каждому сервису (whatsapp ~1G из-за Chromium).
- Все сервисы — `restart: unless-stopped`, healthcheck на `/health`.
- **После пересборки отдельного сервиса** (`docker compose up -d --build <svc>`) Kong может
  кратко отдавать `502` на пулах keepalive-соединений к старому контейнеру. Лечится
  `docker compose restart kong`. В проде при rolling-деплое включить active health checks
  в `kong.yml` (`upstreams[].healthchecks`), чтобы Kong сам выводил мёртвые таргеты.

## 7. Уведомления (надёжность)

Подтверждения брони / алерты владельцу и мастеру идут через очередь
`bookings.notification_outbox` (ставятся в одной транзакции с записью), воркер в
booking-service разбирает её с экспоненциальным backoff (до 5 попыток).
Зависшие записи: `SELECT * FROM bookings.notification_outbox WHERE status = 'failed';`.

## 8. CI

`.github/workflows/ci.yml` — `tsc --noEmit` + Vitest по каждому сервису + `docker compose build`
на PR/push. E2E (Playwright) — по `workflow_dispatch` / ночному cron (поднимает полный стек).
