#!/usr/bin/env bash
# Проверка боем: что сохранённый токен Instagram реально умеет.
#
# Статус «подключено» в админке означает лишь, что Meta опознала токен.
# Он не означает, что токеном можно читать диалоги и отправлять ответы —
# для этого нужны разрешения И одобрение приложения в App Review. Разница
# вскрывается молчанием бота, поэтому проверяем до того, как на него
# понадеялись.
#
# Токен читается из БД и НЕ печатается: в выводе только результаты вызовов.
#
# Запуск: ssh iTTEST 'cd ~/samaya && bash scripts/check-ig-api.sh'

set -uo pipefail
cd "$(dirname "$0")/.."

V="${IG_API_VERSION:-v23.0}"
PROXY="${INSTAGRAM_SOCKS_PROXY:-http://127.0.0.1:1087}"
# Скрипт работает с хоста, а там мост слушает на 127.0.0.1:1087 (сам xray).
[ "$PROXY" = "http://host.docker.internal:1181" ] && PROXY="http://127.0.0.1:1087"

TOKEN=$(printf '%s\n' "\\pset pager off" "SELECT token FROM salons.integration_credentials WHERE provider='instagram';" \
  | docker compose exec -T postgres psql -U samaya -d samaya -t -A -f - 2>/dev/null | tr -d '[:space:]')

if [ -z "$TOKEN" ]; then
  echo "Токен не сохранён. Настройки → Интеграции → вставьте токен."
  exit 1
fi
echo "Токен найден: ${#TOKEN} символов, хвост …${TOKEN: -4}"
echo

IG_ID=$(printf '%s\n' "\\pset pager off" "SELECT meta->>'ig_id' FROM salons.integration_credentials WHERE provider='instagram';" \
  | docker compose exec -T postgres psql -U samaya -d samaya -t -A -f - 2>/dev/null | tr -d '[:space:]')
echo "ID аккаунта Instagram: ${IG_ID:-не записан}"
echo

call() {  # call <описание> <url>
  local label="$1" url="$2"
  local body code
  body=$(curl -s --max-time 25 -x "$PROXY" -w $'\n%{http_code}' "$url" 2>&1)
  code=$(printf '%s' "$body" | tail -1)
  body=$(printf '%s' "$body" | sed '$d')
  if [ "$code" = "200" ]; then
    printf '  %-34s OK\n' "$label"
    printf '%s' "$body" | head -c 400 | sed 's/^/      /'
    echo
  else
    printf '  %-34s HTTP %s\n' "$label" "$code"
    printf '%s' "$body" | head -c 400 | sed 's/^/      /'
    echo
  fi
}

echo "=== Что токен умеет ==="
call "профиль страницы" \
  "https://graph.facebook.com/$V/me?fields=id,name&access_token=$TOKEN"

call "аккаунт Instagram" \
  "https://graph.facebook.com/$V/$IG_ID?fields=id,username,name,followers_count&access_token=$TOKEN"

# Главное: список диалогов. Без одобренного instagram_manage_messages
# Meta вернёт ошибку доступа, хотя разрешение числится выданным.
call "диалоги Direct (conversations)" \
  "https://graph.facebook.com/$V/me/conversations?platform=instagram&fields=id,updated_time&limit=3&access_token=$TOKEN"

echo
echo "=== Срок жизни токена ==="
call "debug_token" \
  "https://graph.facebook.com/$V/debug_token?input_token=$TOKEN&access_token=$TOKEN"
