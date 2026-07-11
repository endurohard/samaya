-- 026_service_preview.sql
-- Превью услуги: описание + видео-ролик для страницы-плеера, ссылку на которую
-- отправляют клиенту. Видео хранится на диске сервера (volume service_media),
-- в БД — только метаданные (путь/mime). preview_enabled = ролик загружен и
-- страница публично доступна по /service.html?id=<service_id>.

SET search_path TO salons, public;

ALTER TABLE services
  ADD COLUMN IF NOT EXISTS description     TEXT,
  ADD COLUMN IF NOT EXISTS video_path      TEXT,      -- относительный путь в media, напр. services/<id>.mp4
  ADD COLUMN IF NOT EXISTS video_mime      TEXT,
  ADD COLUMN IF NOT EXISTS preview_enabled BOOLEAN NOT NULL DEFAULT FALSE;
