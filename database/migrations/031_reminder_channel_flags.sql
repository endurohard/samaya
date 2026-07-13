-- 031_reminder_channel_flags.sql
-- Пер-канальные отметки отправки напоминаний. Раньше был один флаг на окно
-- (reminder_sent_at), поэтому провал одного канала (email) на следующем тике
-- заставлял слать заново и успешный канал (WA) → дубликат сообщения.
-- Теперь каждый канал помечается независимо и повторно не отправляется.

SET search_path TO bookings;

ALTER TABLE bookings.bookings
  ADD COLUMN IF NOT EXISTS reminder_wa_sent_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reminder_email_sent_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reminder_2h_wa_sent_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reminder_2h_email_sent_at TIMESTAMPTZ;

-- Бэкфилл: если умбрелла-флаг уже стоял — считаем оба канала отправленными,
-- чтобы миграция не спровоцировала повторную рассылку по старым записям.
UPDATE bookings.bookings
   SET reminder_wa_sent_at = COALESCE(reminder_wa_sent_at, reminder_sent_at),
       reminder_email_sent_at = COALESCE(reminder_email_sent_at, reminder_sent_at)
 WHERE reminder_sent_at IS NOT NULL;

UPDATE bookings.bookings
   SET reminder_2h_wa_sent_at = COALESCE(reminder_2h_wa_sent_at, reminder_2h_sent_at),
       reminder_2h_email_sent_at = COALESCE(reminder_2h_email_sent_at, reminder_2h_sent_at)
 WHERE reminder_2h_sent_at IS NOT NULL;
