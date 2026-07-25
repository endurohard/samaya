---
type: concept
status: stable
last_verified: 2026-07-15
sources:
  - "infobot:/home/itadmin/infobotit_bot/docker/kong/kong.yml"
  - "infobot:/home/itadmin/infobotit_bot/docker-compose.yml"
  - services/frontend/nginx.conf
  - "iTTEST:~/samaya/.env (FRONTEND_URL)"
---

# Доменная маршрутизация (внешний вход по доменам)

Как публичные домены (в т.ч. `клиника-самая.рф` для samaya) попадают на наши сервисы.

## Топология площадок

Три площадки MikroTik за общим провайдерским шлюзом (см. схему сети, artifact
«Топология MikroTik»):

| Площадка | Роутер / WAN | LAN | Роль |
|---|---|---|---|
| A | 155.17 (iTTEST) | 192.168.5.0/24 (серверы `192.168.5.15`) | хостит **samaya** и **food-flow** |
| B | 155.78 (infobot) | 192.168.2.0/24 | **доменный edge**: Kong 3.9 + itatc.ru |
| C | 155.22 (Besedki) | 192.168.6.0/24 | телефония (Yeastar/FusionPBX) |

Ключевое: **публичные NAT-адреса между площадками недоступны** (напр. .78 → `176.98.155.17:*`
блокируется), а **внутренний L3-линк открыт** — с infobot достижим `192.168.5.15` (iTTEST LAN).
Поэтому апстримы Kong указывают на **внутренний** `192.168.5.15`, а НЕ на публичный `176.98.155.17`.

## Edge: Kong на infobot (176.98.155.78)

- Хост `infobot` (`itadmin@192.168.2.248`, публичный `176.98.155.78`), доступ: `ssh infobot`.
- Контейнер `kong` (kong:3.9.0, **DB-less**), слушает `0.0.0.0:80, 443 ssl`.
- Декларативный конфиг: `/home/itadmin/infobotit_bot/docker/kong/kong.yml`.
- Compose: `/home/itadmin/infobotit_bot/docker-compose.yml`.
- TLS: дефолтный статический cert `itatc.ru` (`KONG_SSL_CERT`, продлевает certbot) + **ACME-плагин**
  (Let's Encrypt, хранилище `infobot-redis`) для остальных доменов.
- Роутинг itatc.ru — по путям (`/dashboard`, `/analitic`, `/` → grafana). Наши домены —
  **host-scoped роуты** (host+path приоритетнее hostless `/`, itatc.ru не задет).

### Текущие внешние домены → сервисы
| Домен | Kong upstream | Проект |
|---|---|---|
| `клиника-самая.рф` (+www) | `http://192.168.5.15:3010` | samaya-frontend ([[../services/frontend-service]]) |
| `food-flow.ru` (+www) | `http://192.168.5.15:8090` | food-flow kong-gateway (SPA + /api) |
| `itatc.ru` | внутренние сервисы infobot | infobot/АТС-аналитика |

samaya-frontend сам проксирует `/api` во внутренний samaya-kong (см. `services/frontend/nginx.conf`,
`server_name _`), поэтому один upstream `:3010` отдаёт и SPA, и API. У food-flow SPA живёт на
`/customer-app`,`/admin-panel`, а API — относительные `/api/*`, поэтому upstream — его **kong-gateway**
(`:8090`), а не голый static-фронт.

## Чек-лист: добавить новый домен на наш сервис

1. **DNS у reg.ru** (домены на `ns1/ns2.reg.ru`): A-запись **на punycode-имя** →
   `176.98.155.78` (apex и `www`). Для IDN (`.рф`) вычислять punycode строго:
   `python3 -c 'print("клиника-самая.рф".encode("idna").decode())'`
   (напр. `клиника-самая.рф` = `xn----7sbba0bamcgqf6c9k.xn--p1ai`). Проверить: `dig +short <puny> A @8.8.8.8`.
   Для `.рф`/`.ru` подтвердить контакты владельца в reg.ru, иначе state `UNVERIFIED` → риск блокировки.
2. **kong.yml на infobot** (бэкап → правка → `docker exec kong kong config parse` → reload):
   - service+route: `url: http://192.168.5.15:<порт-апстрима>`, `hosts: [<puny>, www.<puny>]`
     (Kong принимает **только ASCII/punycode** в hosts!), `preserve_host: true`, `strip_path: false`, `paths: ["/"]`.
   - добавить `<puny>` и `www.<puny>` в `plugins[acme].config.domains`.
3. **Перезапустить контейнер kong**, а не только reload: `cd ~/infobotit_bot && docker compose restart kong`.
   ⚠️ `kong reload` НЕ переинициализирует ACME-обработчик challenge для новых доменов —
   выпуск падает (challenge отдаётся приложением вместо токена). Только restart чинит.
4. **Выпустить cert** (админ-API с хоста infobot, curl в контейнере нет):
   `docker exec infobot-redis redis-cli DEL kong_acme:fail_backoff:<puny> kong_acme:fail_backoff:www.<puny>`
   затем `curl -sX POST http://127.0.0.1:8001/acme -d host=<puny>` (и www). Ждать `... is created`.
5. **Проверить извне** (не с самой .78 — там NAT-hairpin): с любой внешней машины
   `curl -IL https://<домен>/` → 200, `ssl_verify=0`.
6. Если у сервиса есть self-ссылки (письма/уведомления) — выставить его публичный URL
   (для samaya: `FRONTEND_URL=https://<домен>` в `iTTEST:~/samaya/.env` + рестарт booking-service).

## Грабли (проверено на практике 2026-07-15)
- **Апстрим — внутренний `192.168.5.15`**, публичный NAT между площадками закрыт.
- **punycode считать через `idna`**, не на глаз (ошибочный punycode → «домен не резолвится»).
- **`KONG_LUA_SSL_VERIFY_DEPTH=3`** в env kong (в `docker-compose.yml`) — дефолт `1` слишком мал
  для цепочки Let's Encrypt (leaf→intermediate→ISRG Root), ACME падал с `unable to get local issuer certificate`.
- **restart, а не reload** при добавлении домена в ACME (см. шаг 3).
- Kong `hosts` — только punycode/ASCII (unicode `клиника-самая.рф` не проходит `config parse`).
- Сертификаты Kong-ACME продлеваются автоматически (хранилище `infobot-redis`); itatc.ru — своим certbot.

См. также [[../decisions/2026-07-13-security-correctness-audit]], [[../services/frontend-service]].
