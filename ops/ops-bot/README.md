# Агент управления сервисами через Telegram

Бот `@samayaserv_bot` — перезапуск и остановка контейнеров samaya с телефона,
когда нет доступа к серверу.

## Зачем отдельный процесс на хосте

Два ограничения определили конструкцию:

1. **Из контейнера управлять докером нельзя** без проброса `docker.sock`, то есть
   без выдачи веб-приложению прав root на хосте — тому самому приложению, которое
   принимает необработанные сообщения из Instagram.
2. **Сервис не может перезапустить сам себя.** А кнопка нужна ровно тогда, когда
   он завис.

Поэтому агент — отдельный процесс под systemd, вне docker.

Токен **свой**, не общий с уведомлениями из `salon-service`: очередь `getUpdates`
одна на бота, два читателя воруют апдейты друг у друга.

## Команды

    /status              что поднято
    /restart <сервис>    перезапустить
    /stop <сервис>       остановить
    /start_svc <сервис>  запустить
    /logs <сервис>       последние строки лога

Управление доступом (только владелец):

    /admins              кто имеет доступ
    /addadmin <id> <имя> выдать
    /deladmin <id>       снять

## Два уровня доступа

**Владельцы** — в `TG_ADMINS` файла `config.env` на сервере. Раздают и снимают
права. Снять владельца командой нельзя: иначе можно разжаловать всех и остаться
без доступа к боту, не имея способа вернуть права.

**Назначенные админы** — в `admins.json`, заводятся командой `/addadmin`.
Управляют сервисами, но раздавать доступ дальше не могут.

Список админов хранится отдельным файлом, а не в `config.env`: тот правит человек
руками, и переписывать его из кода — верный способ однажды затереть токен.

Посторонним бот отвечает «нет доступа» и показывает их id; попытка пишется в журнал.

## Что защищено

| Сервис | Перезапуск | Остановка |
|---|---|---|
| whatsapp-service, instagram-service | да | да |
| salon-service, frontend-service | да | нет |
| postgres, kong | нет | нет |

`postgres` и `kong` недоступны намеренно — промах по кнопке с телефона не должен
ронять всю систему.

## Файлы

    bot.py                     агент
    config.env.example         шаблон конфига (боевой — только на сервере, 600)
    samaya-ops-bot.service     юнит systemd

На сервере:

    /home/it/ops-bot/bot.py
    /home/it/ops-bot/config.env    права 600, в git не попадает
    /home/it/ops-bot/admins.json   назначенные админы, 600
    /home/it/ops-bot/audit.log     кто, что, когда
    /home/it/ops-bot/bot.log       вывод агента

## Развернуть

    mkdir -p /home/it/ops-bot && cp bot.py /home/it/ops-bot/
    cp config.env.example /home/it/ops-bot/config.env
    chmod 600 /home/it/ops-bot/config.env
    # вписать TG_TOKEN (у @BotFather) и TG_ADMINS (свой id у @userinfobot)
    sudo cp samaya-ops-bot.service /etc/systemd/system/
    sudo systemctl daemon-reload && sudo systemctl enable --now samaya-ops-bot

Проверка:

    systemctl is-active samaya-ops-bot
    tail -5 /home/it/ops-bot/bot.log

## Обслуживание

    sudo systemctl restart samaya-ops-bot    после правки bot.py
    tail -20 /home/it/ops-bot/audit.log      кто что делал

Требования на хосте: пользователь в группе `docker`, Python 3 (без зависимостей,
только стандартная библиотека), доступ к `api.telegram.org`.
