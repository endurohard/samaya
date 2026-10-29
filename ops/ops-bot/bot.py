#!/usr/bin/env python3
"""
Агент управления контейнерами samaya через Telegram.

Зачем отдельный процесс на хосте, а не ещё один маршрут в salon-service:
управлять докером из контейнера можно только пробросив docker.sock, то есть
отдав веб-приложению права root на хосте — тому самому, которое принимает
необработанные сообщения из Instagram. И главное: сервис не может
перезапустить сам себя, а нужда в кнопке возникает ровно тогда, когда он
и завис.

Свой токен бота, а не общий с уведомлениями: очередь getUpdates одна на
бота, два читателя воруют апдейты друг у друга.
"""
import json
import os
import subprocess
import time
import urllib.parse
import urllib.request

BASE = os.path.dirname(os.path.abspath(__file__))
CONFIG = os.path.join(BASE, "config.env")
ADMINS_FILE = os.path.join(BASE, "admins.json")
AUDIT = os.path.join(BASE, "audit.log")
COMPOSE_DIR = "/home/it/samaya"


def load_config():
    cfg = {}
    with open(CONFIG, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            cfg[k.strip()] = v.strip()
    return cfg


CFG = load_config()
TOKEN = CFG.get("TG_TOKEN", "")
API = f"https://api.telegram.org/bot{TOKEN}"
# Прямого выхода в Telegram у сервера нет (ни IPv4, ни IPv6 — проверено:
# «Network is unreachable»), весь трафик идёт через локальный мост xray.
# В /etc/environment он прописан как socks5://127.0.0.1:1080, но это файл
# для сессий входа — systemd его не читает, поэтому адрес задаётся здесь.
# Схему пишем http://: стандартная библиотека socks5 не умеет, а мост
# принимает и обычный HTTP CONNECT.
PROXY = CFG.get("TG_PROXY", "http://127.0.0.1:1080").strip()
_opener = urllib.request.build_opener(
    urllib.request.ProxyHandler({"http": PROXY, "https": PROXY} if PROXY else {})
)
ALLOWED = [s.strip() for s in CFG.get("TG_ALLOWED", "").split(",") if s.strip()]
STOPPABLE = [s.strip() for s in CFG.get("TG_STOPPABLE", "").split(",") if s.strip()]
# Владельцы из config.env неудаляемы: иначе можно случайно разжаловать всех
# и остаться без доступа к боту, не имея способа вернуть права.
OWNERS = [s.strip() for s in CFG.get("TG_ADMINS", "").split(",") if s.strip()]


def load_admins():
    """Назначенные админы хранятся отдельным файлом, а не в config.env:
    его правит человек руками, и переписывать его из кода — верный способ
    однажды затереть токен."""
    try:
        with open(ADMINS_FILE, encoding="utf-8") as f:
            data = json.load(f)
            return {str(k): v for k, v in data.items()}
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def save_admins(admins):
    tmp = ADMINS_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(admins, f, ensure_ascii=False, indent=2)
    os.replace(tmp, ADMINS_FILE)
    os.chmod(ADMINS_FILE, 0o600)


def is_owner(uid):
    return str(uid) in OWNERS


def is_admin(uid):
    return is_owner(uid) or str(uid) in load_admins()


def audit(uid, name, action, result):
    with open(AUDIT, "a", encoding="utf-8") as f:
        f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')}\t{uid}\t{name}\t{action}\t{result}\n")


def api(method, **params):
    url = f"{API}/{method}?" + urllib.parse.urlencode(params)
    try:
        # Через _opener, а не urlopen: сервер ходит наружу только через мост.
        with _opener.open(url, timeout=40) as r:
            return json.load(r)
    except Exception as e:
        print("[tg] ошибка:", e, flush=True)
        return {}


def send(chat_id, text):
    api("sendMessage", chat_id=chat_id, text=text, parse_mode="HTML")


def compose(*args, timeout=180):
    try:
        p = subprocess.run(
            ["docker", "compose", *args],
            cwd=COMPOSE_DIR, capture_output=True, text=True, timeout=timeout,
        )
        return (p.stdout + p.stderr).strip()
    except subprocess.TimeoutExpired:
        return "команда не уложилась во время"


def cmd_status():
    out = compose("ps", "--format", "{{.Name}}\t{{.Status}}")
    if not out:
        return "не удалось получить список"
    lines = []
    for ln in out.splitlines():
        if "\t" not in ln:
            continue
        name, status = ln.split("\t", 1)
        mark = "✅" if "Up" in status else "🔴"
        lines.append(f"{mark} <b>{name.replace('samaya-', '')}</b> — {status}")
    return "<b>Состояние сервисов</b>\n\n" + "\n".join(sorted(lines))


def cmd_restart(service):
    if service not in ALLOWED:
        return f"«{service}» перезапускать нельзя.\nМожно: {', '.join(ALLOWED)}"
    out = compose("restart", service, timeout=240)
    ok = "Error" not in out and "error" not in out
    return ("♻️ Перезапущен <b>%s</b>" % service) if ok else f"Не вышло:\n<code>{out[-400:]}</code>"


def cmd_stop(service):
    if service not in STOPPABLE:
        return (f"«{service}» останавливать нельзя — так можно уронить всю систему.\n"
                f"Можно: {', '.join(STOPPABLE)}")
    out = compose("stop", service, timeout=120)
    ok = "Error" not in out and "error" not in out
    return ("⏸ Остановлен <b>%s</b>" % service) if ok else f"Не вышло:\n<code>{out[-400:]}</code>"


def cmd_start(service):
    if service not in ALLOWED:
        return f"«{service}» запускать нельзя.\nМожно: {', '.join(ALLOWED)}"
    out = compose("up", "-d", service, timeout=240)
    ok = "Error" not in out and "error" not in out
    return ("▶️ Запущен <b>%s</b>" % service) if ok else f"Не вышло:\n<code>{out[-400:]}</code>"


def cmd_logs(service, n=20):
    if service not in ALLOWED:
        return f"Логи «{service}» недоступны.\nМожно: {', '.join(ALLOWED)}"
    out = compose("logs", "--tail", str(n), service, timeout=60)
    out = "\n".join(ln for ln in out.splitlines() if '"url"' not in ln)
    return f"<b>{service}</b>, последние строки:\n<code>{out[-3000:]}</code>"


def cmd_admins():
    admins = load_admins()
    txt = "<b>Кто управляет ботом</b>\n\n<b>Владельцы</b> (из конфига, снять нельзя):\n"
    txt += "\n".join(f"  • <code>{o}</code>" for o in OWNERS) or "  —"
    txt += "\n\n<b>Назначенные</b>:\n"
    if admins:
        for uid, info in admins.items():
            who = info.get("name", "—")
            by = info.get("added_by", "—")
            txt += f"  • <code>{uid}</code> {who} (добавил {by})\n"
    else:
        txt += "  —\n"
    return txt


def cmd_addadmin(uid, args, who):
    if not is_owner(uid):
        return "Назначать админов может только владелец."
    if not args:
        return ("Как пользоваться: <code>/addadmin 123456789 Имя</code>\n"
                "Свой id человек узнаёт у @userinfobot")
    new_id = args[0].strip()
    if not new_id.isdigit():
        return "id должен быть числом. Узнать: @userinfobot"
    name = " ".join(args[1:]).strip() or "без имени"
    admins = load_admins()
    if new_id in admins or new_id in OWNERS:
        return f"<code>{new_id}</code> уже имеет доступ."
    admins[new_id] = {"name": name, "added_by": who, "added_at": time.strftime("%Y-%m-%d %H:%M")}
    save_admins(admins)
    return f"✅ Доступ выдан: <code>{new_id}</code> {name}"


def cmd_deladmin(uid, args):
    if not is_owner(uid):
        return "Снимать админов может только владелец."
    if not args:
        return "Как пользоваться: <code>/deladmin 123456789</code>"
    target = args[0].strip()
    if target in OWNERS:
        return "Владельца снять нельзя — он прописан в конфиге на сервере."
    admins = load_admins()
    if target not in admins:
        return f"<code>{target}</code> и так не имеет доступа."
    name = admins.pop(target).get("name", "")
    save_admins(admins)
    return f"🚫 Доступ снят: <code>{target}</code> {name}"


HELP = """<b>Управление сервисами «Самая»</b>

/status — что сейчас поднято
/restart &lt;сервис&gt; — перезапустить
/stop &lt;сервис&gt; — остановить
/start_svc &lt;сервис&gt; — запустить
/logs &lt;сервис&gt; — последние строки лога

<b>Доступ</b> (только владелец):
/admins — кто имеет доступ
/addadmin &lt;id&gt; &lt;имя&gt; — выдать
/deladmin &lt;id&gt; — снять

Сервисы: {allowed}
Останавливать можно: {stoppable}"""


def handle(msg):
    text = (msg.get("text") or "").strip()
    if not text.startswith("/"):
        return
    chat_id = msg["chat"]["id"]
    frm = msg.get("from", {})
    uid = frm.get("id")
    who = frm.get("username") or frm.get("first_name") or str(uid)

    if not is_admin(uid):
        # Молчим в ответ, но фиксируем: так видно попытки достучаться.
        audit(uid, who, text.split()[0], "ОТКАЗАНО: нет доступа")
        send(chat_id, f"Нет доступа. Ваш id: <code>{uid}</code> — передайте его владельцу.")
        return

    parts = text.split()
    cmd = parts[0].split("@")[0].lower()
    args = parts[1:]
    svc = args[0] if args else ""

    if cmd in ("/start", "/help"):
        out = HELP.format(allowed=", ".join(ALLOWED), stoppable=", ".join(STOPPABLE))
    elif cmd == "/status":
        out = cmd_status()
    elif cmd == "/restart":
        out = cmd_restart(svc) if svc else "Укажите сервис: <code>/restart whatsapp-service</code>"
    elif cmd == "/stop":
        out = cmd_stop(svc) if svc else "Укажите сервис: <code>/stop whatsapp-service</code>"
    elif cmd == "/start_svc":
        out = cmd_start(svc) if svc else "Укажите сервис: <code>/start_svc whatsapp-service</code>"
    elif cmd == "/logs":
        out = cmd_logs(svc) if svc else "Укажите сервис: <code>/logs whatsapp-service</code>"
    elif cmd == "/admins":
        out = cmd_admins()
    elif cmd == "/addadmin":
        out = cmd_addadmin(uid, args, who)
    elif cmd == "/deladmin":
        out = cmd_deladmin(uid, args)
    else:
        out = "Не знаю такой команды. /help"

    audit(uid, who, text, out.split("\n")[0][:80])
    send(chat_id, out)


def main():
    if not TOKEN or TOKEN == "СЮДА_ТОКЕН":
        raise SystemExit("TG_TOKEN не заполнен в config.env")
    print(f"[tg] агент запущен, владельцев: {len(OWNERS)}", flush=True)
    offset = 0
    while True:
        r = api("getUpdates", offset=offset, timeout=30)
        for upd in r.get("result", []):
            offset = upd["update_id"] + 1
            msg = upd.get("message") or upd.get("edited_message")
            if msg:
                try:
                    handle(msg)
                except Exception as e:
                    print("[tg] сбой обработки:", e, flush=True)
        if not r.get("ok"):
            time.sleep(5)


if __name__ == "__main__":
    main()
