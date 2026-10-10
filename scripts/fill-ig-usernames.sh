#!/usr/bin/env bash
# Подтянуть ники Instagram для диалогов, где их нет.
#
# Webhook присылает только IGSID, поэтому у диалогов, пришедших до
# подключения подгрузки профиля, в списке стоит «без имени». Скрипт
# добирает их одним проходом.
set -euo pipefail
cd "$(dirname "$0")/.."

PROXY=$(grep -m1 '^IG_HOST_PROXY=' .env 2>/dev/null | cut -d= -f2- || true)
PROXY=${PROXY:-http://127.0.0.1:1087}

read -r TOKEN HOST VER <<<"$(docker compose exec -T postgres psql -U samaya -d samaya -tAc \
  "SELECT token || ' ' || coalesce(meta->>'host','graph.instagram.com')
          || ' ' || coalesce(meta->>'api_version','v23.0')
     FROM salons.integration_credentials WHERE provider='instagram'" | tr -d '\r')"

if [ -z "${TOKEN:-}" ]; then
  echo "Токен не сохранён. Админка → Настройки → Интеграции."
  exit 1
fi

IDS=$(docker compose exec -T postgres psql -U samaya -d samaya -tAc \
  "SELECT thread_id FROM instagram.threads WHERE username IS NULL" | tr -d '\r')

if [ -z "$IDS" ]; then
  echo "Все диалоги уже с никами."
  exit 0
fi

echo "Диалогов без ника: $(echo "$IDS" | grep -c .)"
echo

ok=0; fail=0
for id in $IDS; do
  [ -z "$id" ] && continue
  resp=$(curl -s -g --max-time 20 -x "$PROXY" \
    "https://$HOST/$VER/$id?fields=name,username,profile_pic&access_token=$TOKEN")

  name=$(printf '%s' "$resp" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("username") or "")' 2>/dev/null || true)
  full=$(printf '%s' "$resp" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("name") or "")' 2>/dev/null || true)
  pic=$(printf  '%s' "$resp" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("profile_pic") or "")' 2>/dev/null || true)

  if [ -n "$name" ]; then
    # Значения передаём параметрами psql, а не вставкой в текст запроса:
    # долларовые кавычки ($$) bash раскрывает как переменную, и в SQL
    # попадал мусор вида «3155849sokolova.sell3155849».
    docker compose exec -T \
      -e V_USER="$name" -e V_FULL="$full" -e V_PIC="$pic" -e V_ID="$id" \
      postgres psql -U samaya -d samaya -q \
      -c "UPDATE instagram.threads
             SET username = :'u',
                 full_name = NULLIF(:'f', ''),
                 avatar_url = NULLIF(:'p', '')
           WHERE thread_id = :'i'" \
      -v u="$name" -v f="$full" -v p="$pic" -v i="$id" 
    printf '  %-20s @%s\n' "$id" "$name"
    ok=$((ok+1))
  else
    err=$(printf '%s' "$resp" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("error",{}).get("message","?")[:60])' 2>/dev/null || echo '?')
    printf '  %-20s — %s\n' "$id" "$err"
    fail=$((fail+1))
  fi
  sleep 0.3
done

echo
echo "Получено: $ok, не удалось: $fail"
