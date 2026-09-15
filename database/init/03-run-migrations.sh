#!/bin/bash
# Первая инициализация тома postgres_data: накат миграций изнутри контейнера.
#
# Сама логика — в database/migrate.sh (общая с сервисом `migrator`, который
# догоняет миграции на каждом `docker compose up`). Здесь только вызов, чтобы
# свежесозданная база сразу имела и схему, и заполненный журнал
# public.schema_migrations — иначе migrator увидит непустую базу с пустым
# журналом и потребует baseline.

set -e

exec /migrate.sh
