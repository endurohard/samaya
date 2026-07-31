-- 045_promo_page_opens.sql
--
-- Второй счётчик страницы акции: page_views — уникальные посетители
-- (по cookie), page_opens — все открытия. Разрыв между ними показывает,
-- сколько раз ссылку пересматривали: для рекламы это отдельный сигнал.
-- Бэкфилл: у уже открывавшихся акций открытий не меньше, чем уникальных.

SET search_path TO bookings, public;

ALTER TABLE promotions
  ADD COLUMN IF NOT EXISTS page_opens INT NOT NULL DEFAULT 0;

UPDATE promotions SET page_opens = page_views WHERE page_opens = 0 AND page_views > 0;
