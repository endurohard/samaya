#!/usr/bin/env bash
# Посмотреть входящие Direct прямо сейчас, через Graph API.
#
# Это независимая от webhook проверка: читает переписку тем же токеном
# страницы, что сохранён в админке. Полезна, чтобы отделить «Meta нам
# ничего не шлёт» от «у нас сломан приём».
set -euo pipefail
cd "$(dirname "$0")/.."

PROXY=$(grep -m1 '^INSTAGRAM_SOCKS_PROXY=' .env 2>/dev/null | cut -d= -f2- || true)
PROXY=${PROXY:-http://127.0.0.1:1087}
VER=$(grep -m1 '^IG_API_VERSION=' .env 2>/dev/null | cut -d= -f2- || true)
VER=${VER:-v23.0}

TOKEN=$(docker compose exec -T postgres psql -U samaya -d samaya -tAc \
  "SELECT token FROM salons.integration_credentials WHERE provider='instagram'" | tr -d '[:space:]')

if [ -z "$TOKEN" ]; then
  echo "Токен не сохранён. Админка → Настройки → Интеграции."
  exit 1
fi

api() { curl -s --max-time 30 -x "$PROXY" "https://graph.facebook.com/$VER/$1&access_token=$TOKEN"; }

echo "=== Аккаунт ==="
api "me?fields=id,name,instagram_business_account{id,username,followers_count}" |
  python3 -c '
import sys, json
d = json.load(sys.stdin)
if "error" in d:
    e = d["error"]
    print("  ОШИБКА:", e.get("message"))
    print("  код:", e.get("code"), "подкод:", e.get("error_subcode", "—"))
    sys.exit(1)
ig = d.get("instagram_business_account") or {}
print("  страница:  ", d.get("name"))
print("  инстаграм: @" + str(ig.get("username")), "| подписчиков:", ig.get("followers_count"))
'

echo
echo "=== Последние диалоги Direct ==="
api "me/conversations?platform=instagram&fields=participants,updated_time,messages.limit(1){message,from,created_time}&limit=10" |
  python3 -c '
import sys, json
d = json.load(sys.stdin)
if "error" in d:
    e = d["error"]
    print("  ОШИБКА:", e.get("message"))
    code, sub = e.get("code"), e.get("error_subcode")
    if code == 10 or (code == 200 and sub):
        print()
        print("  Нет разрешения на чтение переписки.")
        print("  Нужен Advanced Access к instagram_manage_messages:")
        print("  App Review → Permissions and Features → Request Advanced Access.")
    elif code == 190:
        print()
        print("  Токен истёк или отозван — перевыпустите в админке.")
    sys.exit(1)
rows = d.get("data", [])
if not rows:
    print("  Диалогов нет. Если в приложении Instagram они есть — значит")
    print("  токену не хватает доступа, а не переписки.")
for c in rows:
    who = ", ".join(p.get("username") or p.get("name") or p.get("id")
                    for p in (c.get("participants", {}) or {}).get("data", []))
    msgs = (c.get("messages", {}) or {}).get("data", [])
    last = msgs[0].get("message", "") if msgs else ""
    last = (last[:60] + "…") if len(last) > 60 else last
    print(f"  {c.get(\"updated_time\", \"\")[:16]}  {who[:34]:34} {last}")
'

echo
echo "Если диалоги видны здесь, но не в CRM — Meta не шлёт webhook:"
echo "проверьте подписку на поле messages и ключи в .env (bash scripts/check-webhook.sh)."
