-- Найденные группы и темы Telegram.
--
-- getUpdates отдаёт очередь событий и очищает её: нажав «Определить»
-- второй раз, владелец увидел бы пустой список, хотя тема никуда не
-- делась. Поэтому найденное копим здесь и показываем накопленное.
CREATE TABLE IF NOT EXISTS ai.telegram_seen (
  company_id  uuid NOT NULL,
  chat_id     text NOT NULL,
  thread_id   integer NOT NULL DEFAULT 0,   -- 0 = общая лента (NULL не годится для ключа)
  chat_title  text,
  topic_name  text,
  last_text   text,
  seen_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, chat_id, thread_id)
);

COMMENT ON TABLE ai.telegram_seen IS
  'Кэш групп и тем, замеченных ботом: очередь getUpdates одноразовая';
