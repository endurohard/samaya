#!/usr/bin/env bash
# Бэкап PostgreSQL (pg_dump custom format) из контейнера samaya-postgres.
# Ротация: хранится RETENTION_DAYS дней (по умолчанию 14).
#
# Запуск вручную:  ./scripts/backup-db.sh
# Cron (ежедневно в 03:30):
#   30 3 * * * /Users/bagamedovyusup/work/samaya/scripts/backup-db.sh >> /var/log/samaya-backup.log 2>&1
#
# Восстановление (ОСТОРОЖНО — перезапишет данные):
#   docker exec -i samaya-postgres pg_restore -U samaya -d samaya --clean --if-exists < backups/samaya_YYYY-MM-DD_HHMMSS.dump
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$REPO_DIR/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
CONTAINER="${CONTAINER:-samaya-postgres}"
PG_USER="${POSTGRES_USER:-samaya}"
PG_DB="${POSTGRES_DB:-samaya}"

mkdir -p "$BACKUP_DIR"

STAMP="$(date +%F_%H%M%S)"
OUT="$BACKUP_DIR/samaya_${STAMP}.dump"

if ! docker exec "$CONTAINER" pg_isready -U "$PG_USER" -d "$PG_DB" >/dev/null 2>&1; then
  echo "[backup] FATAL: контейнер $CONTAINER недоступен или postgres не готов" >&2
  exit 1
fi

docker exec "$CONTAINER" pg_dump -U "$PG_USER" -d "$PG_DB" -Fc > "$OUT"

SIZE=$(du -h "$OUT" | cut -f1)
echo "[backup] $(date '+%F %T') OK: $OUT ($SIZE)"

# Ротация
DELETED=$(find "$BACKUP_DIR" -name 'samaya_*.dump' -mtime +"$RETENTION_DAYS" -print -delete | wc -l | tr -d ' ')
[ "$DELETED" != "0" ] && echo "[backup] удалено старых бэкапов: $DELETED"

# Простая проверка целостности: дамп читается pg_restore --list
docker exec -i "$CONTAINER" pg_restore --list >/dev/null < "$OUT"
echo "[backup] проверка целостности OK"
