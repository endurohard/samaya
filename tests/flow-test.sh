#!/usr/bin/env bash
# Эмуляция пользовательских флоу + edge-cases через API (Kong → сервисы).
# Запуск: BASE=http://localhost:3010 ./flow-test.sh
set -u
BASE="${BASE:-http://localhost:3010}"
pass=0; fail=0
check() { if [ "$2" = "$3" ]; then printf "  ✓ %-48s %s\n" "$1" "$3"; pass=$((pass+1));
          else printf "  ✘ %-48s ожидал %s, got %s\n" "$1" "$2" "$3"; fail=$((fail+1)); fi; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
jget() { python3 -c "import sys,json; d=json.load(sys.stdin); print(d$1)" 2>/dev/null; }

echo "═══ 1. АВТОРИЗАЦИЯ ═══"
LOGIN=$(curl -s -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"playwright@samaya.test","password":"PlaywrightTest123!"}')
TOKEN=$(echo "$LOGIN" | jget "['access_token']")
if [ -n "$TOKEN" ]; then echo "  ✓ логин владельца → токен получен"; pass=$((pass+1));
else echo "  ✘ логин не дал токен: $LOGIN"; fail=$((fail+1)); fi
check "логин с неверным паролем" 401 "$(code -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -d '{"email":"playwright@samaya.test","password":"wrong"}')"
check "логин без тела" 400 "$(code -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -d '{}')"

H_AUTH="Authorization: Bearer $TOKEN"

echo "═══ 2. ДОСТУП БЕЗ ТОКЕНА → 401 ═══"
check "GET /api/clients" 401 "$(code "$BASE/api/clients")"
check "GET /api/bookings" 401 "$(code "$BASE/api/bookings?from=2026-06-01&to=2026-06-30")"
check "GET /api/salary/schemes" 401 "$(code "$BASE/api/salary/schemes")"
check "POST /api/whatsapp/send" 401 "$(code -X POST "$BASE/api/whatsapp/send" -H 'Content-Type: application/json' -d '{"phone":"7999","message":"x"}')"
check "POST /api/clients с битым токеном" 401 "$(code "$BASE/api/clients" -H 'Authorization: Bearer garbage.token.here')"

echo "═══ 3. ЧТЕНИЕ ДАННЫХ С ТОКЕНОМ → 200 ═══"
for ep in "/api/clients" "/api/salons/services" "/api/salons/masters" \
          "/api/bookings?from=2026-06-01&to=2026-06-30" \
          "/api/bookings/analytics?from=2026-06-01&to=2026-06-30" \
          "/api/bookings/analytics/masters?from=2026-06-01&to=2026-06-30" \
          "/api/inventory/products" "/api/finance/accounts" "/api/salary/schemes"; do
  check "GET ${ep%%\?*}" 200 "$(code "$BASE$ep" -H "$H_AUTH")"
done

echo "═══ 4. ВАЛИДАЦИЯ ВВОДА → 400 ═══"
check "bookings без from/to" 400 "$(code "$BASE/api/bookings" -H "$H_AUTH")"
check "bookings с битой датой" 400 "$(code "$BASE/api/bookings?from=2026-13-99&to=2026-12-31" -H "$H_AUTH")"
check "analytics без дат" 400 "$(code "$BASE/api/bookings/analytics" -H "$H_AUTH")"

echo "═══ 5. RBAC: client не может создавать услуги → 403 ═══"
# регистрируем временного клиента
CL=$(curl -s -X POST "$BASE/api/auth/register" -H 'Content-Type: application/json' \
  -d '{"email":"flowtest-client@test.dev","password":"password123"}')
CTOK=$(echo "$CL" | jget "['access_token']")
CROLE=$(echo "$CL" | jget "['user']['role']")
check "роль публичной регистрации = client" "client" "$CROLE"
if [ -n "$CTOK" ]; then
  check "client POST /api/salons/services → 403" 403 "$(code -X POST "$BASE/api/salons/services" -H "Authorization: Bearer $CTOK" -H 'Content-Type: application/json' -d '{"name":"hack","price":1,"duration_minutes":1}')"
fi

echo "═══ 6. ПУБЛИЧНЫЙ ВИДЖЕТ: создание брони + проверка слота ═══"
MID="352b6443-7507-403d-a97e-783ccd2d57b6"
SVC=$(curl -s "$BASE/api/salons/services" -H "$H_AUTH" | jget "['items'][0]['id']" 2>/dev/null)
SLOT=$(python3 -c "import datetime;print((datetime.datetime.now()+datetime.timedelta(days=7)).strftime('%Y-%m-%dT13:00:00+03:00'))")
mkjson() { python3 -c "import json,sys; json.dump({'master_id':sys.argv[1],'service_ids':[sys.argv[2]],'starts_at':sys.argv[3],'client_phone':sys.argv[4],'client_name':sys.argv[5]}, sys.stdout)" "$@"; }
mkjson "$MID" "$SVC" "$SLOT" 79990001122 "Flow Тест" > /tmp/ft_bk1.json
mkjson "$MID" "$SVC" "$SLOT" 79990003344 "Flow Тест2" > /tmp/ft_bk2.json
mkjson "00000000-0000-0000-0000-000000000000" "$SVC" "$SLOT" 79990005566 "Flow Тест3" > /tmp/ft_bk3.json
BK=$(curl -s -X POST "$BASE/api/bookings/public/create" -H 'Content-Type: application/json' --data @/tmp/ft_bk1.json)
BID=$(echo "$BK" | jget "['booking_id']")
if [ -n "$BID" ]; then echo "  ✓ публичная бронь создана ($BID)"; pass=$((pass+1)); else echo "  ✘ бронь не создалась: $BK"; fail=$((fail+1)); fi
check "двойная бронь в тот же слот → 409" 409 "$(code -X POST "$BASE/api/bookings/public/create" -H 'Content-Type: application/json' --data @/tmp/ft_bk2.json)"
check "бронь с несуществующим мастером → 404" 404 "$(code -X POST "$BASE/api/bookings/public/create" -H 'Content-Type: application/json' --data @/tmp/ft_bk3.json)"
check "бронь с битым JSON → 400" 400 "$(code -X POST "$BASE/api/bookings/public/create" -H 'Content-Type: application/json' -d 'oops')"
check "bookings с несуществующей датой → 400" 400 "$(code "$BASE/api/bookings?from=2026-13-99&to=2026-12-31" -H "$H_AUTH")"

echo "═══ 7. КЛИЕНТСКИЙ ПОРТАЛ ═══"
check "портал с несуществующим токеном → 404" 404 "$(code "$BASE/api/clients/portal/00000000-0000-0000-0000-000000000000")"

echo ""
echo "════════════════════════════════════"
echo "ИТОГО: $pass passed, $fail failed"
echo "BID_FOR_CLEANUP=$BID"
[ "$fail" -eq 0 ] && exit 0 || exit 1
