#!/usr/bin/env python3
"""Подтянуть ники Instagram для диалогов, где их нет.

Webhook присылает только IGSID, поэтому у диалогов, пришедших до
подключения подгрузки профиля, в списке стоит «без имени».

Python, а не shell: ник приходит из внешнего API и попадает в SQL —
подстановка через строки дважды ломалась на кавычках, а параметры psql
внутри docker compose exec не разворачиваются. Здесь значения уходят
параметрами запроса, и спецсимволы в нике уже не имеют значения.
"""
import json
import os
import subprocess
import sys
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)


def sql_literal(v):
    """Строковый литерал SQL с экранированием кавычек."""
    return "'" + str(v).replace("'", "''") + "'"


def psql(sql, *params):
    """Выполнить запрос в контейнере postgres, вернуть строки.

    Значения подставляются литералами с экранированием кавычек, а не
    параметрами: psql внутри docker compose exec не разворачивает ни
    :'v', ни $n, и обе попытки это обойти ломались на разборе текста.
    """
    for i, p in enumerate(params, 1):
        sql = sql.replace(f"${i}", sql_literal(p))
    args = ["docker", "compose", "exec", "-T", "postgres",
            "psql", "-U", "samaya", "-d", "samaya", "-tA", "-F", "\t", "-c", sql]
    r = subprocess.run(args, capture_output=True, text=True)
    if r.returncode != 0:
        print("  SQL:", r.stderr.strip()[:120])
        return None
    return [l.split("\t") for l in r.stdout.strip().splitlines() if l]


def main():
    rows = psql("SELECT token, coalesce(meta->>'host','graph.instagram.com'), "
                "coalesce(meta->>'api_version','v23.0') "
                "FROM salons.integration_credentials WHERE provider='instagram'")
    if not rows:
        print("Токен не сохранён. Админка → Настройки → Интеграции.")
        return 1
    token, host, ver = rows[0][0], rows[0][1], rows[0][2]

    proxy = os.environ.get("IG_HOST_PROXY", "http://127.0.0.1:1087")
    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({"https": proxy, "http": proxy}))

    ids = psql("SELECT thread_id FROM instagram.threads WHERE username IS NULL")
    ids = [r[0] for r in (ids or []) if r and r[0]]
    if not ids:
        print("Все диалоги уже с никами.")
        return 0

    print(f"Диалогов без ника: {len(ids)}\n")
    ok = fail = 0
    for igsid in ids:
        url = (f"https://{host}/{ver}/{igsid}"
               f"?fields=name,username,profile_pic"
               f"&access_token={urllib.parse.quote(token)}")
        try:
            with opener.open(url, timeout=20) as resp:
                data = json.load(resp)
        except Exception as e:
            body = getattr(e, "file", None)
            msg = "?"
            if body:
                try:
                    msg = json.load(body).get("error", {}).get("message", "?")[:58]
                except Exception:
                    pass
            print(f"  {igsid:<20} — {msg}")
            fail += 1
            continue

        username = data.get("username")
        if not username:
            print(f"  {igsid:<20} — профиль без ника")
            fail += 1
            continue

        psql("UPDATE instagram.threads SET username = $1, "
             "full_name = NULLIF($2,''), avatar_url = NULLIF($3,'') "
             "WHERE thread_id = $4",
             username, data.get("name") or "", data.get("profile_pic") or "", igsid)
        print(f"  {igsid:<20} @{username}")
        ok += 1

    print(f"\nПолучено: {ok}, не удалось: {fail}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
