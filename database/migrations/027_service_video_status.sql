-- 027_service_video_status.sql
-- Статус фоновой конвертации видео-превью услуги в веб-совместимый MP4 (H.264/AAC).
--   processing — загружено, идёт конвертация (публично ещё не показываем);
--   ready      — сконвертировано, preview_enabled = TRUE;
--   failed     — конвертация не удалась, показываем оригинал как есть (fallback).

SET search_path TO salons, public;

ALTER TABLE services
  ADD COLUMN IF NOT EXISTS video_status TEXT;
