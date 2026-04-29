#!/bin/bash
# Auto-runs all SQL migrations from /migrations/ in alphabetical order
# at first container startup. Pattern скопирован из food-flow.
#
# Идемпотентность миграций — на стороне их .sql (CREATE TABLE IF NOT EXISTS,
# ALTER TABLE ... ADD COLUMN IF NOT EXISTS, и т.п.). Скрипт сам не отслеживает,
# что уже применено — это задача авторов миграций.

set -e

MIGRATIONS_DIR="/migrations"

if [ ! -d "$MIGRATIONS_DIR" ]; then
  echo "[migrations] $MIGRATIONS_DIR not found, skipping"
  exit 0
fi

count=$(find "$MIGRATIONS_DIR" -maxdepth 1 -name "*.sql" 2>/dev/null | wc -l)
if [ "$count" -eq 0 ]; then
  echo "[migrations] no .sql files in $MIGRATIONS_DIR, skipping"
  exit 0
fi

echo "[migrations] applying $count migration(s) from $MIGRATIONS_DIR..."

for migration in $(find "$MIGRATIONS_DIR" -maxdepth 1 -name "*.sql" | sort); do
  echo "[migrations] applying $(basename "$migration")"
  psql -v ON_ERROR_STOP=1 \
       --username "$POSTGRES_USER" \
       --dbname "$POSTGRES_DB" \
       --file "$migration"
done

echo "[migrations] done"
