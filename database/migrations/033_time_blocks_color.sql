-- 033_time_blocks_color.sql
-- Цвет метки занятого времени: мастера помечают разные причины (обед, обучение,
-- личное) разными цветами, чтобы читать календарь не вчитываясь в подписи.

SET search_path TO bookings;

ALTER TABLE time_blocks
  ADD COLUMN IF NOT EXISTS color TEXT;
