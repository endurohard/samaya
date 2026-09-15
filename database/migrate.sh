#!/bin/sh
# Раннер миграций с учётом уже применённого.
#
# Зачем: раньше миграции накатывались только при первой инициализации тома
# postgres_data (database/init/), а на живой базе — руками по инструкции из
# docs/DEPLOYMENT.md. При 50+ файлах это гарантированно кончается «а у нас на
# проде 049 не накатилась». Теперь состояние хранится в самой базе, и накат
# идемпотентен: запускать можно на каждом старте.
#
# Запускается в двух местах и должен работать в обоих:
#   1. database/init/03-run-migrations.sh — при первой инициализации тома,
#      изнутри контейнера postgres (подключение через локальный сокет);
#   2. сервис `migrator` в docker-compose — при каждом `up`, по сети.
# Отсюда подключение только через переменные PG* — никаких --host в коде.
#
# Переменные:
#   MIGRATIONS_DIR      каталог с *.sql (по умолчанию /migrations)
#   MIGRATE_BASELINE    разовый режим для БД, созданной до этого скрипта:
#                       `all` — пометить все файлы применёнными не выполняя их,
#                       `053_x.sql` — пометить все файлы до указанного включительно.
#   MIGRATE_ALLOW_DRIFT =1 — не падать, если файл изменился после применения.

set -eu

MIGRATIONS_DIR="${MIGRATIONS_DIR:-/migrations}"

# Подключение только через PG*. В сервисе `migrator` они приходят из compose,
# а внутри контейнера postgres (init-скрипты) их нет — там есть POSTGRES_*,
# и без подстановки psql пошёл бы под несуществующую роль `postgres`.
export PGUSER="${PGUSER:-${POSTGRES_USER:-}}"
export PGDATABASE="${PGDATABASE:-${POSTGRES_DB:-}}"

PSQL="psql -v ON_ERROR_STOP=1 --no-psqlrc --quiet"

log() { echo "[migrate] $*"; }
fail() { echo "[migrate] ОШИБКА: $*" >&2; exit 1; }

[ -d "$MIGRATIONS_DIR" ] || fail "$MIGRATIONS_DIR не найден"

# Список миграций в порядке применения: имена, а не пути — сортировать надо по
# имени файла. Номера трёхзначные с ведущими нулями, поэтому обычного sort
# достаточно (сломается только на 1000-й миграции).
migrations=$(cd "$MIGRATIONS_DIR" && ls -1 *.sql 2>/dev/null | sort || true)
[ -n "$migrations" ] || { log "миграций нет, выходим"; exit 0; }

# --- Журнал применённого -----------------------------------------------------
# Таблица в public: она общая для всех сервисов, не принадлежит ни одной схеме.
$PSQL <<'SQL'
CREATE TABLE IF NOT EXISTS public.schema_migrations (
  version     TEXT        PRIMARY KEY,
  checksum    TEXT        NOT NULL,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  duration_ms INTEGER
);
COMMENT ON TABLE public.schema_migrations IS
  'Применённые миграции из database/migrations. Ведёт database/migrate.sh.';
SQL

applied_count=$($PSQL -tAc 'SELECT count(*) FROM public.schema_migrations')

# --- Baseline для БД, созданной до появления трекинга ------------------------
# Если журнал пуст, а данные в базе уже есть, применять всё заново нельзя:
# часть миграций не идемпотентна (backfill-блоки, сиды). Требуем от оператора
# явного решения вместо молчаливого наката или молчаливого пропуска.
if [ "$applied_count" = "0" ]; then
  populated=$($PSQL -tAc "SELECT count(*) FROM information_schema.tables
                          WHERE table_schema IN ('users','salons','bookings','clients',
                                                 'inventory','finance','salary','telephony')")
  if [ "$populated" != "0" ] && [ -z "${MIGRATE_BASELINE:-}" ]; then
    fail "база уже содержит таблицы, но журнал миграций пуст.
  Это существующая БД, созданная до появления трекинга. Накатывать всё заново
  нельзя. Разово укажите, что в ней уже применено:
    MIGRATE_BASELINE=all              — применено всё, что лежит в $MIGRATIONS_DIR
    MIGRATE_BASELINE=049_assistant_assignments.sql — применено по этот файл включительно
  Проверить фактическое состояние: \\dt users.*  \\dt telephony.*"
  fi
fi

if [ -n "${MIGRATE_BASELINE:-}" ]; then
  log "baseline: помечаем применённым без выполнения (до '$MIGRATE_BASELINE')"
  for name in $migrations; do
    sum=$(sha256sum "$MIGRATIONS_DIR/$name" | cut -d' ' -f1)
    $PSQL -q -c "INSERT INTO public.schema_migrations (version, checksum)
                 VALUES ('$name', '$sum') ON CONFLICT (version) DO NOTHING"
    log "  baseline $name"
    [ "$MIGRATE_BASELINE" = "all" ] || [ "$name" != "$MIGRATE_BASELINE" ] || break
  done
  log "baseline записан, миграции не выполнялись"
fi

# --- Накат -------------------------------------------------------------------
pending=0
for name in $migrations; do
  sum=$(sha256sum "$MIGRATIONS_DIR/$name" | cut -d' ' -f1)
  known=$($PSQL -tAc "SELECT checksum FROM public.schema_migrations WHERE version = '$name'")

  if [ -n "$known" ]; then
    if [ "$known" != "$sum" ] && [ "${MIGRATE_ALLOW_DRIFT:-}" != "1" ]; then
      fail "$name изменился после применения (checksum в базе $known, у файла $sum).
  Применённую миграцию править нельзя — заведите новую. Если правка заведомо
  безобидна (комментарий, форматирование), перезапустите с MIGRATE_ALLOW_DRIFT=1,
  и журнал обновится."
    fi
    if [ "$known" != "$sum" ]; then
      log "drift: $name изменился, обновляем checksum (MIGRATE_ALLOW_DRIFT=1)"
      $PSQL -q -c "UPDATE public.schema_migrations SET checksum = '$sum' WHERE version = '$name'"
    fi
    continue
  fi

  log "применяем $name"
  started=$(date +%s)
  # Миграция и отметка о ней — в одной транзакции: упавшая миграция не
  # оставляет ни половины изменений, ни записи в журнале. Ни в одной из
  # текущих миграций нет CREATE INDEX CONCURRENTLY и собственного BEGIN/COMMIT
  # (все BEGIN — это тела plpgsql-функций), поэтому оборачивать безопасно.
  $PSQL --single-transaction \
        -f "$MIGRATIONS_DIR/$name" \
        -c "INSERT INTO public.schema_migrations (version, checksum) VALUES ('$name', '$sum')" \
    || fail "$name не применилась, изменения откачены"
  ms=$(( ($(date +%s) - started) * 1000 ))
  $PSQL -q -c "UPDATE public.schema_migrations SET duration_ms = $ms WHERE version = '$name'"
  pending=$((pending + 1))
done

if [ "$pending" = "0" ]; then
  log "новых миграций нет (применено: $($PSQL -tAc 'SELECT count(*) FROM public.schema_migrations'))"
else
  log "применено миграций: $pending"
fi
