-- Связь уведомления в Telegram с диалогом канала.
--
-- Менеджер отвечает реплаем на уведомление, и по reply_to_message.message_id
-- нужно понять, в какой диалог Instagram отправлять ответ. Без этой таблицы
-- связь существует только в голове у менеджера.
CREATE TABLE IF NOT EXISTS ai.telegram_outbox (
  company_id  uuid NOT NULL,
  chat_id     text NOT NULL,
  message_id  bigint NOT NULL,
  channel     text NOT NULL,
  thread_key  text NOT NULL,          -- id диалога внутри канала
  who         text,                   -- ник собеседника, для журнала
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_tg_outbox_company
  ON ai.telegram_outbox (company_id, created_at DESC);

-- Смещение очереди getUpdates.
--
-- Очередь одна на бота: если её читают двое, события достаются тому, кто
-- успел первым, и половина ответов менеджера теряется. Поэтому читатель
-- ровно один — фоновый опрос, — а поиск групп берёт данные из ai.telegram_seen.
CREATE TABLE IF NOT EXISTS ai.telegram_cursor (
  company_id  uuid PRIMARY KEY,
  offset_id   bigint NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
