#!/usr/bin/env bash
# Проверка приёма webhook: подписываем тело тем же секретом, что в .env,
# и смотрим, доходит ли сообщение до классификатора.
#
# Это ровно то, что делает Meta: POST с заголовком X-Hub-Signature-256,
# где подпись — HMAC-SHA256 сырого тела по секрету приложения.
set -euo pipefail
cd "$(dirname "$0")/.."

SECRET=$(grep -m1 '^INSTAGRAM_APP_SECRET=' .env 2>/dev/null | cut -d= -f2- || true)
VERIFY=$(grep -m1 '^INSTAGRAM_VERIFY_TOKEN=' .env 2>/dev/null | cut -d= -f2- || true)
BASE=${1:-http://127.0.0.1:8000}

if [ -z "$SECRET" ]; then
  echo "INSTAGRAM_APP_SECRET не задан в .env — webhook не примет ни одного сообщения."
  echo "Секрет берётся в кабинете Meta: Настройки приложения → Основное → Секрет приложения."
  exit 1
fi

echo "=== 1. Верификация подписки (так Meta подключает webhook) ==="
if [ -n "$VERIFY" ]; then
  got=$(curl -s "$BASE/api/instagram/webhook?hub.mode=subscribe&hub.verify_token=$VERIFY&hub.challenge=проверка42")
  if [ "$got" = "проверка42" ]; then
    echo "  ✓ отвечает challenge — Meta примет подключение"
  else
    echo "  ✗ вернулось: $got"
  fi
else
  echo "  INSTAGRAM_VERIFY_TOKEN не задан — пропускаю"
fi

echo
echo "=== 2. Приём сообщения с верной подписью ==="
# IGSID заведомо несуществующий: отправка ответа не пройдёт, и это нормально —
# проверяем приём, запись и классификацию, а не доставку клиенту.
BODY='{"object":"instagram","entry":[{"id":"17841400000000000","time":1760000000,"messaging":[{"sender":{"id":"test-igsid-000"},"recipient":{"id":"17841400000000000"},"timestamp":1760000000000,"message":{"mid":"test-mid-'"$RANDOM"'","text":"как проходит процедура?"}}]}]}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  -H 'Content-Type: application/json' \
  -H "X-Hub-Signature-256: sha256=$SIG" \
  -d "$BODY" "$BASE/api/instagram/webhook")
echo "  HTTP $code (Meta ждёт 200 сразу, до обработки)"

echo
echo "=== 3. Поддельная подпись должна быть отвергнута ==="
bad=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  -H 'Content-Type: application/json' \
  -H 'X-Hub-Signature-256: sha256=deadbeef' \
  -d "$BODY" "$BASE/api/instagram/webhook")
echo "  HTTP $bad (ждём 403)"

echo
echo "=== 4. Что записалось и как решил ассистент ==="
sleep 3
docker compose exec -T postgres psql -U samaya -d samaya -q <<'SQL'
\pset pager off
SELECT direction, left(body, 40) AS текст, created_at::time(0) AS время
  FROM instagram.messages
 WHERE thread_id LIKE 'test-igsid%' ORDER BY created_at DESC LIMIT 3;
SELECT topic AS тема, confidence AS уверенность, action AS решение
  FROM ai.reply_log ORDER BY created_at DESC LIMIT 3;
SQL

echo
echo "Подсказка: логи обработки — docker compose logs instagram-service | grep -i webhook"
