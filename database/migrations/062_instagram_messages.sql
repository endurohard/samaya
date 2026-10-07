-- 062_instagram_messages.sql
--
-- Переписка с клиентами в Instagram Direct: история диалогов в CRM.
--
-- Зачем отдельная схема, а не повторное использование whatsapp.messages:
-- у Instagram нет телефона. Собеседник опознаётся не номером, а парой
-- thread_id + igsid (внутренний id пользователя), и связать его с карточкой
-- клиента автоматически по ключу нельзя — только руками или по номеру,
-- который человек сам написал в переписке. Вешать это на таблицу, где
-- phone_digits NOT NULL и служит основным ключом связывания, значило бы
-- сломать логику WhatsApp ради чужого случая.
--
-- Источник данных — та же приватная сессия браузера, что и у WhatsApp:
-- сервис держит залогиненный Chromium на instagram.com. Поэтому в истории
-- оказываются и ответы, отправленные администратором с телефона.
--
--   ig_id      — item_id сообщения из Direct, он же первичный ключ: при
--                каждом опросе диалога приходят те же сообщения, и
--                ON CONFLICT DO NOTHING делает загрузку идемпотентной.
--   thread_id  — идентификатор диалога, стабилен и переживает смену ника.
--   sender_id  — числовой id автора в Instagram. Ник меняется, id — нет,
--                поэтому направление определяем по нему, а не по имени.

CREATE SCHEMA IF NOT EXISTS instagram;

SET search_path TO instagram, public;

-- Диалог. Отдельная таблица, потому что привязка к клиенту живёт на уровне
-- переписки, а не сообщения: администратор один раз говорит «этот диалог —
-- вот эта клиентка», и вся история, прошлая и будущая, должна прицепиться
-- сама.
CREATE TABLE IF NOT EXISTS threads (
  thread_id    TEXT PRIMARY KEY,
  company_id   UUID        NOT NULL,
  client_id    UUID        REFERENCES clients.clients(id) ON DELETE SET NULL,
  -- Ник и имя — копией на момент последнего обхода. Человек может
  -- переименоваться, и тогда старая переписка стала бы неопознаваемой.
  username     TEXT,
  full_name    TEXT,
  avatar_url   TEXT,
  -- Счётчик непрочитанных со страницы Instagram: по нему монитор решает,
  -- в какие диалоги заходить, и не листает всю переписку подряд.
  unread       INT         NOT NULL DEFAULT 0,
  last_at      TIMESTAMPTZ,
  last_body    TEXT,
  -- Черновик ответа от ИИ-ответчика. Лежит в диалоге, а не в отдельной
  -- таблице: черновик всегда ровно один и живёт до того, как администратор
  -- его отправит или отклонит. Отдельная таблица здесь дала бы только
  -- лишний JOIN на каждый показ списка.
  ai_draft     TEXT,
  ai_draft_at  TIMESTAMPTZ,
  -- Вердикт классификатора: можно ли было отвечать без человека. Храним,
  -- чтобы в интерфейсе было видно, почему черновик не ушёл сам.
  ai_safe      BOOLEAN,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ig_threads_recent
  ON threads(company_id, last_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_ig_threads_client
  ON threads(client_id) WHERE client_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS messages (
  ig_id        TEXT PRIMARY KEY,
  company_id   UUID        NOT NULL,
  thread_id    TEXT        NOT NULL REFERENCES threads(thread_id) ON DELETE CASCADE,
  client_id    UUID        REFERENCES clients.clients(id) ON DELETE SET NULL,
  sender_id    TEXT,
  sender_name  TEXT,
  from_me      BOOLEAN     NOT NULL,
  body         TEXT        NOT NULL DEFAULT '',
  -- text | media | share | story_reply | story_mention | voice | unsupported
  msg_type     TEXT        NOT NULL DEFAULT 'text',
  -- Путь относительно INSTAGRAM_MEDIA_DIR, как в whatsapp.messages:
  -- фото и голосовые за год — гигабайты, в bytea они раздули бы каждый
  -- ночной pg_dump.
  media_path   TEXT,
  media_name   TEXT,
  media_mime   TEXT,
  media_size   INT,
  -- Кто из сотрудников отправил. Копией, а не джойном к users: после
  -- увольнения подпись в истории должна остаться.
  author_id    UUID,
  author_name  TEXT,
  sent_at      TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Диалог в карточке клиента.
CREATE INDEX IF NOT EXISTS idx_ig_messages_client
  ON messages(client_id, sent_at DESC) WHERE client_id IS NOT NULL;

-- Лента одного диалога.
CREATE INDEX IF NOT EXISTS idx_ig_messages_thread
  ON messages(thread_id, sent_at DESC);

-- Уведомления о новых входящих: опрашивается браузером каждого менеджера,
-- поэтому отбор идёт по created_at (когда МЫ узнали), а не по sent_at.
CREATE INDEX IF NOT EXISTS idx_ig_messages_incoming
  ON messages(company_id, created_at DESC) WHERE from_me = FALSE;

COMMENT ON TABLE threads IS
  'Диалоги Instagram Direct. Привязка к клиенту живёт здесь, а не в сообщениях.';
COMMENT ON TABLE messages IS
  'История переписки Instagram. Тексты здесь, вложения — на диске (media_path).';
COMMENT ON COLUMN messages.ig_id IS
  'item_id сообщения в Direct; первичный ключ ради идемпотентности повторных обходов';
