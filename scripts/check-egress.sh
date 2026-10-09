#!/usr/bin/env bash
# Проверка: через какой адрес каждый сервис выходит в интернет.
#
# Зачем нужен отдельный скрипт, а не «посмотреть переменные в .env»:
# заданная переменная INSTAGRAM_SOCKS_PROXY доказывает только то, что её
# кто-то вписал. Она не доказывает, что прокси жив, что сервис его читает и
# что трафик действительно уходит в туннель. Проверять надо по факту —
# сравнением выходного адреса.
#
# Что важно: сервисы Meta (WhatsApp, Instagram) обязаны выходить ЛОКАЛЬНЫМ
# адресом. Аккаунты и клиника российские; выход с голландского адреса
# сервера Meta читает как угон и блокирует аккаунт. Плюс с прямого маршрута
# домены Meta вообще не резолвятся (ENOTFOUND).
#
# Запуск на боевом сервере:
#   ssh iTTEST 'cd ~/samaya && bash scripts/check-egress.sh'

set -uo pipefail
cd "$(dirname "$0")/.."

echo "=== Опорные адреса ==="
DIRECT=$(curl -s --max-time 10 https://api.ipify.org || echo "недоступен")
VLESS=$(curl -s --max-time 10 -x http://127.0.0.1:1087 https://api.ipify.org || echo "недоступен")
echo "  прямой выход сервера: $DIRECT"
echo "  выход через VLESS:    $VLESS"
echo

if [ "$DIRECT" = "$VLESS" ]; then
  echo "  ВНИМАНИЕ: адреса совпали — туннель не работает или не используется."
  echo
fi

# Сервисы, которым туннель обязателен, и переменная, где лежит их прокси.
META_SERVICES="whatsapp-service:WHATSAPP_SOCKS_PROXY instagram-service:INSTAGRAM_SOCKS_PROXY salon-service:INSTAGRAM_SOCKS_PROXY"

echo "=== Сервисы, работающие с Meta ==="
for entry in $META_SERVICES; do
  svc="${entry%%:*}"
  var="${entry##*:}"

  if ! docker compose ps --services --filter status=running 2>/dev/null | grep -qx "$svc"; then
    printf "  %-20s не запущен\n" "$svc"
    continue
  fi

  proxy=$(docker compose exec -T "$svc" printenv "$var" 2>/dev/null | tr -d '\r\n')
  if [ -z "$proxy" ]; then
    printf "  %-20s ПРОКСИ НЕ ЗАДАН — трафик пойдёт напрямую\n" "$svc"
    continue
  fi

  # Выходной адрес проверяем изнутри контейнера через его собственный прокси:
  # только так видно то, что увидит Meta.
  ip=$(docker compose exec -T "$svc" node -e "
    const u = new URL(process.env.$var);
    const req = require('http').request(
      { host: u.hostname, port: u.port, method: 'CONNECT', path: 'api.ipify.org:443', timeout: 15000 });
    req.on('connect', (res, sock) => {
      const tls = require('tls').connect({ socket: sock, servername: 'api.ipify.org' }, () => {
        tls.write('GET / HTTP/1.1\r\nHost: api.ipify.org\r\nConnection: close\r\n\r\n');
      });
      let d = ''; tls.on('data', c => d += c);
      tls.on('end', () => { console.log(d.trim().split('\n').pop()); process.exit(0); });
    });
    req.on('error', e => { console.log('ОШИБКА: ' + e.message); process.exit(0); });
    req.on('timeout', () => { console.log('таймаут'); process.exit(0); });
    req.end();
  " 2>/dev/null | tail -1)

  if [ "$ip" = "$VLESS" ]; then
    printf "  %-20s %s — через VLESS, верно\n" "$svc" "$ip"
  elif [ "$ip" = "$DIRECT" ]; then
    printf "  %-20s %s — ПРЯМОЙ ВЫХОД, аккаунт под угрозой\n" "$svc" "$ip"
  else
    printf "  %-20s %s\n" "$svc" "$ip"
  fi
done

echo
echo "=== Доступность доменов Meta из контейнеров ==="
for entry in $META_SERVICES; do
  svc="${entry%%:*}"
  var="${entry##*:}"
  docker compose ps --services --filter status=running 2>/dev/null | grep -qx "$svc" || continue
  proxy=$(docker compose exec -T "$svc" printenv "$var" 2>/dev/null | tr -d '\r\n')
  [ -z "$proxy" ] && continue

  for host in graph.facebook.com graph.instagram.com; do
    code=$(docker compose exec -T "$svc" node -e "
      const u = new URL(process.env.$var);
      const req = require('http').request(
        { host: u.hostname, port: u.port, method: 'CONNECT', path: '$host:443', timeout: 15000 });
      req.on('connect', () => { console.log('доступен'); process.exit(0); });
      req.on('error', () => { console.log('НЕДОСТУПЕН'); process.exit(0); });
      req.on('timeout', () => { console.log('таймаут'); process.exit(0); });
      req.end();
    " 2>/dev/null | tail -1)
    printf "  %-20s %-22s %s\n" "$svc" "$host" "$code"
  done
done
