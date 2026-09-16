-- 058_whatsapp_messages.sql
--
-- Переписка с клиентами в WhatsApp: история сообщений в карточке клиента.
--
-- Зачем: администратор ведёт переписку с телефона, и в CRM от неё не остаётся
-- ничего — кто что обещал клиенту, какие фото анализов он присылал, на чём
-- остановились. Сеанс WhatsApp Web видит все сообщения номера салона (и наши
-- ответы из админки, и отправленные администратором с телефона), поэтому
-- история получается полной независимо от того, откуда отвечали.
--
-- Тексты — здесь, файлы — на диске (WHATSAPP_MEDIA_DIR, том whatsapp_media),
-- как это уже сделано с записями разговоров телефонии. Голосовые и фото за год
-- — это гигабайты; в bytea они раздули бы базу и каждый ночной pg_dump.
--
--   wa_id        — идентификатор сообщения в WhatsApp, он же первичный ключ:
--                  события приходят повторно при переподключении сеанса, и
--                  ON CONFLICT DO NOTHING делает загрузку идемпотентной.
--   client_id    — проставляется по номеру, если клиент есть в базе. NULL
--                  допустим: сообщение могло прийти раньше, чем завели
--                  карточку, и связать его нужно задним числом.
--   phone_digits — нормализованный номер (только цифры) для связывания:
--                  в clients.clients телефоны хранятся в разных форматах.
--   ack          — статус доставки от WhatsApp: -1 ошибка, 0 в очереди,
--                  1 отправлено, 2 доставлено, 3 прочитано, 4 прослушано.

CREATE SCHEMA IF NOT EXISTS whatsapp;

SET search_path TO whatsapp, public;

CREATE TABLE IF NOT EXISTS messages (
  wa_id        TEXT PRIMARY KEY,
  company_id   UUID        NOT NULL,
  client_id    UUID        REFERENCES clients.clients(id) ON DELETE SET NULL,
  chat_id      TEXT        NOT NULL,
  phone_digits TEXT        NOT NULL,
  from_me      BOOLEAN     NOT NULL,
  body         TEXT        NOT NULL DEFAULT '',
  msg_type     TEXT        NOT NULL DEFAULT 'chat',
  -- Путь относительно WHATSAPP_MEDIA_DIR: <phone_digits>/<wa_id>.<ext>.
  -- Относительный, а не абсолютный, чтобы том можно было перемонтировать.
  media_path   TEXT,
  media_name   TEXT,
  media_mime   TEXT,
  media_size   INT,
  ack          SMALLINT    NOT NULL DEFAULT 0,
  sent_at      TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Диалог в карточке клиента: последние сообщения сверху.
CREATE INDEX IF NOT EXISTS idx_wa_messages_client
  ON messages(client_id, sent_at DESC) WHERE client_id IS NOT NULL;

-- Связывание задним числом: найти сообщения по номеру, когда карточку клиента
-- завели позже, чем пришло первое сообщение.
CREATE INDEX IF NOT EXISTS idx_wa_messages_phone
  ON messages(company_id, phone_digits, sent_at DESC);

-- Список диалогов и непрочитанное.
CREATE INDEX IF NOT EXISTS idx_wa_messages_chat
  ON messages(company_id, chat_id, sent_at DESC);

COMMENT ON TABLE messages IS
  'История переписки WhatsApp. Тексты здесь, вложения — на диске (media_path).';
COMMENT ON COLUMN messages.ack IS
  'Статус доставки: -1 ошибка, 0 в очереди, 1 отправлено, 2 доставлено, 3 прочитано, 4 прослушано';
