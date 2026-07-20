#!/usr/bin/env bash
# smoke-api.sh — проходит по всем публичным эндпоинтам реальным токеном и
# показывает, что отвечает не то, что должно.
#
# Ловит целый класс поломок, которые не видит ни один юнит-тест: неверный
# маршрут в Kong, упавший контейнер, разъехавшуюся схему валидации, 500 из-за
# кривого SQL. Именно так были найдены blocks?from=YYYY-MM-DD → 400 и
# /api/bookings/:id/history.
#
# Запуск:  ./scripts/smoke-api.sh [BASE_URL] [PHONE] [PASSWORD]
# Пример:  ./scripts/smoke-api.sh https://клиника-самая.рф +79286117111 'Qwerty1234'

set -uo pipefail

BASE="${1:-http://127.0.0.1:8010}"
PHONE="${2:-}"
PASS="${3:-}"
HOST_HDR="${HOST_HDR:-}"

pass=0; fail=0
CURL=(curl -sk --max-time 20)
[ -n "$HOST_HDR" ] && CURL+=(-H "Host: $HOST_HDR")

login() {
  local body
  body=$("${CURL[@]}" -X POST -H 'Content-Type: application/json' \
    -d "{\"phone\":\"$PHONE\",\"password\":\"$PASS\"}" "$BASE/api/auth/login")
  echo "$body" | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p'
}

# check <ожидаемый код> <метод> <путь> [тело]
check() {
  local want="$1" method="$2" path="$3" data="${4:-}"
  local args=(-o /dev/null -w '%{http_code}' -X "$method" -H "Authorization: Bearer $TOKEN")
  [ -n "$data" ] && args+=(-H 'Content-Type: application/json' -d "$data")
  local code
  code=$("${CURL[@]}" "${args[@]}" "$BASE$path")
  if [ "$code" = "$want" ]; then
    pass=$((pass+1)); printf '  ok   %-6s %-55s %s\n' "$method" "$path" "$code"
  else
    fail=$((fail+1)); printf '  FAIL %-6s %-55s %s (ждали %s)\n' "$method" "$path" "$code" "$want"
  fi
}

TODAY=$(date +%F)
MONTH_AGO=$(date -v-30d +%F 2>/dev/null || date -d '30 days ago' +%F)

if [ -z "$PHONE" ]; then
  echo "Нужны телефон и пароль: ./scripts/smoke-api.sh BASE PHONE PASSWORD"; exit 2
fi

TOKEN=$(login)
if [ -z "$TOKEN" ]; then echo "Не удалось войти — проверьте телефон и пароль"; exit 1; fi
echo "Вход выполнен, токен получен"

echo
echo "── Записи ──"
check 200 GET "/api/bookings?from=$TODAY&to=$TODAY"
check 200 GET "/api/bookings?from=$TODAY&to=$TODAY&by=completed"
check 200 GET "/api/bookings/blocks?from=$TODAY&to=$TODAY"
check 200 GET "/api/bookings/sales?from=$MONTH_AGO&to=$TODAY"
check 200 GET "/api/bookings/analytics?from=$MONTH_AGO&to=$TODAY"
check 200 GET "/api/bookings/analytics/masters?from=$MONTH_AGO&to=$TODAY"
check 200 GET "/api/bookings/analytics/services?from=$MONTH_AGO&to=$TODAY"
check 200 GET "/api/bookings/analytics/retention-by-service?group_by=category"
check 200 GET "/api/bookings/analytics/retention-by-service?group_by=service"
check 200 GET "/api/bookings/retention"
check 200 GET "/api/bookings/reviews"
# Заведомо неверные параметры должны давать 400, а не 500
check 400 GET "/api/bookings?from=2026-13-99&to=$TODAY"
check 400 GET "/api/bookings/blocks?from=нет-даты&to=$TODAY"
check 404 GET "/api/bookings/00000000-0000-0000-0000-000000000000"

echo
echo "── Клиенты ──"
check 200 GET "/api/clients?segment=all&limit=5"
check 200 GET "/api/clients/segments"
check 200 GET "/api/clients?segment=all&search=демо"
check 404 GET "/api/clients/00000000-0000-0000-0000-000000000000"

echo
echo "── Салон ──"
check 200 GET "/api/salons/masters"
check 200 GET "/api/salons/services"
check 200 GET "/api/salons/categories"
check 200 GET "/api/salons/schedule?from=$TODAY&to=$TODAY"

echo
echo "── Зарплата ──"
check 200 GET "/api/salary/calculate?from=$MONTH_AGO&to=$TODAY"
check 200 GET "/api/salary/schemes"
check 200 GET "/api/salary/accruals"
check 200 GET "/api/salary/payouts"
check 200 GET "/api/salary/commissions"
check 200 GET "/api/salary/staff-groups"
check 200 GET "/api/salary/settlements?from=$MONTH_AGO&to=$TODAY"

echo
echo "── Финансы и склад ──"
check 200 GET "/api/finance/accounts"
check 200 GET "/api/finance/operations?from=$MONTH_AGO&to=$TODAY"
check 200 GET "/api/inventory/products"
check 200 GET "/api/inventory/stock"

echo
echo "── Доступ без токена должен отклоняться ──"
for p in "/api/bookings?from=$TODAY&to=$TODAY" "/api/clients?segment=all" "/api/salary/calculate?from=$TODAY&to=$TODAY"; do
  code=$("${CURL[@]}" -o /dev/null -w '%{http_code}' "$BASE$p")
  if [ "$code" = "401" ]; then
    pass=$((pass+1)); printf '  ok   %-6s %-55s 401\n' "GET" "$p"
  else
    fail=$((fail+1)); printf '  FAIL %-6s %-55s %s (ждали 401)\n' "GET" "$p" "$code"
  fi
done

echo
echo "Итог: успешно $pass, с ошибками $fail"
[ "$fail" -eq 0 ] || exit 1
