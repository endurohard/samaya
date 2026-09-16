# Выкат обновления на прод

Проверено на копии прод-базы 16.09.2026: восстановлен свежий дамп (7454 клиента,
55 применённых миграций), прогнан тот же раннер, что пойдёт на прод.
Результат — применились ровно 2 новые миграции, данные целы, повторный запуск
ничего не делает, откат работает.

## Перед выкатом

### 1. Бэкап (обязательно)

```bash
ssh iTTEST 'docker exec samaya-postgres pg_dump -U samaya -d samaya -Fc' > backups/prod_$(date +%F_%H%M%S).dump
```

Убедитесь, что файл не пустой и читается (локальный `pg_restore` версии 14 не
прочитает дамп PG 16 — проверяйте через контейнер):

```bash
docker cp backups/<файл>.dump samaya-postgres:/tmp/check.dump
docker exec samaya-postgres pg_restore -l /tmp/check.dump | grep -c "TABLE DATA"   # ожидается ~61
```

### 2. Переменные WhatsApp в `.env` на проде

Сейчас в прод-`.env` нет ни одной переменной `WHATSAPP_*`. Добавьте явно:

```
WHATSAPP_TEST_MODE=true
WHATSAPP_MONITOR=false
WHATSAPP_ALLOWLIST=79633707007
```

Почему это важно:

- `WHATSAPP_MONITOR` — монитор запускается только при значении `true`.
  Он обходит чаты боевого номера и складывает переписку в базу, включая личные
  чаты. Включать осознанно, отдельным решением.
- `WHATSAPP_TEST_MODE=true` — сообщения пишутся в лог, наружу не уходят.
- `WHATSAPP_ALLOWLIST` — пока список непустой, отправка идёт только на эти
  номера. Пустой список = разрешено всё; сервис предупредит об этом в логе при
  старте, но не остановится.

## Выкат

```bash
ssh iTTEST
cd ~/samaya
git pull
VATS_API_KEY=<ключ> docker compose build
VATS_API_KEY=<ключ> docker compose up -d
```

Миграции накатывает сервис `migrator` при старте: применит только 058 и 059,
остальные 55 пропустит по контрольной сумме. Каждая миграция идёт в отдельной
транзакции — при ошибке откатывается целиком и выкат останавливается.

## Проверка после выката

```bash
# миграций должно стать 57
docker exec samaya-postgres psql -U samaya -d samaya -tAc "SELECT count(*) FROM schema_migrations"

# данные на месте
docker exec samaya-postgres psql -U samaya -d samaya -tAc "SELECT count(*) FROM clients.clients"

# сервисы подняты
docker compose ps

# в логе WhatsApp не должно быть предупреждения про пустой allowlist
docker logs samaya-whatsapp --tail 20
```

## Откат

База: `database/ROLLBACK_058_059.sql` (проверен на копии прода).

Код: `git checkout <предыдущий коммит> && docker compose up -d --build`.

Полное восстановление из дампа — только если что-то пошло совсем не так:

```bash
docker exec -i samaya-postgres pg_restore -U samaya -d samaya --clean --if-exists < backups/<файл>.dump
```
