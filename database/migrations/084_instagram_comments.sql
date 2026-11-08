-- Комментарии к постам Instagram.
--
-- Директ живёт в instagram.messages, а комментарии — отдельная сущность:
-- они публичные, привязаны к посту, на них отвечают либо публично (ответ
-- под комментарием), либо ОДИН раз приватно в директ (private reply, окно
-- 7 дней). Поэтому своя таблица со статусом обработки.
--
-- Источники: вебхук Meta (поле comments) и периодический обход последних
-- постов — обход догоняет то, что вебхук не прислал (подписка, сбой связи).
CREATE TABLE IF NOT EXISTS instagram.comments (
  company_id        uuid        NOT NULL,
  comment_id        text        NOT NULL,
  media_id          text        NOT NULL,
  parent_id         text,                     -- ответ на другой комментарий
  from_id           text,
  username          text,
  body              text        NOT NULL DEFAULT '',
  from_me           boolean     NOT NULL DEFAULT false,
  hidden            boolean     NOT NULL DEFAULT false,
  commented_at      timestamptz NOT NULL,
  -- Обработка в CRM
  status            text        NOT NULL DEFAULT 'new',   -- new | done | ignored
  replied_at        timestamptz,              -- ответили публично
  private_sent_at   timestamptz,              -- приватный ответ в директ (один раз)
  handled_by        text,
  created_at        timestamptz NOT NULL DEFAULT NOW(),
  updated_at        timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, comment_id)
);
CREATE INDEX IF NOT EXISTS comments_status_idx ON instagram.comments (company_id, status, commented_at DESC);
CREATE INDEX IF NOT EXISTS comments_media_idx ON instagram.comments (company_id, media_id, commented_at);

-- Посты: подпись и ссылка для показа рядом с комментарием.
CREATE TABLE IF NOT EXISTS instagram.media (
  company_id     uuid        NOT NULL,
  media_id       text        NOT NULL,
  caption        text,
  permalink      text,
  media_type     text,
  thumbnail_url  text,
  posted_at      timestamptz,
  comments_count integer,
  synced_at      timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, media_id)
);

COMMENT ON TABLE instagram.comments IS 'Комментарии к постам Instagram: вебхук comments + обход последних постов';
COMMENT ON COLUMN instagram.comments.private_sent_at IS 'приватный ответ в директ — Meta разрешает один на комментарий, в течение 7 дней';
