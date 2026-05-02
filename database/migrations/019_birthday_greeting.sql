-- 019_birthday_greeting.sql
-- Отслеживание отправки поздравлений с ДР

ALTER TABLE clients.clients
  ADD COLUMN IF NOT EXISTS birthday_last_sent DATE;

COMMENT ON COLUMN clients.clients.birthday_last_sent IS
  'Дата последней отправки поздравления с ДР. Поздравляем раз в год.';
