-- Кэш загруженных в Meta вложений.
--
-- Отправка вложения по публичной ссылке (payload.url) у подключения через
-- Instagram Login НЕ работает вовсе: Meta отвечает «Upload failed»
-- (2018007) даже на заведомо доступный файл со стороннего CDN, причём не
-- присылая ни одного запроса за файлом. Рабочий путь — загрузка файла
-- телом запроса в /message_attachments, в ответ приходит attachment_id,
-- которым дальше и отправляется сообщение.
--
-- Схемы зон (круговая липосакция ног) не меняются месяцами, поэтому
-- attachment_id достаточно получить один раз: связка из трёх сообщений
-- уходит без повторной загрузки 100 КБ на каждое фото.
--
-- Ключ — имя файла плюс его размер и mtime: если картинку заменили
-- (выложили новую версию схемы), ключ меняется сам, и старый
-- attachment_id не подставится вместо новой картинки.
CREATE TABLE IF NOT EXISTS instagram.attachment_cache (
  company_id    uuid        NOT NULL,
  asset_key     text        NOT NULL,
  attachment_id text        NOT NULL,
  kind          text        NOT NULL DEFAULT 'image',
  created_at    timestamptz NOT NULL DEFAULT NOW(),
  used_at       timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, asset_key)
);

COMMENT ON TABLE instagram.attachment_cache IS
  'attachment_id загруженных в Meta вложений: отправка по ссылке у Instagram Login не работает';
COMMENT ON COLUMN instagram.attachment_cache.asset_key IS
  'имя файла + размер + mtime — при замене картинки ключ меняется сам';
