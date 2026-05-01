-- 015_wa_reminders.sql
-- Флаги отправленных WA-напоминаний на записях.
-- reminder_sent_at  — напоминание за 24ч
-- reminder_2h_sent_at — напоминание за 2ч

ALTER TABLE bookings.bookings
  ADD COLUMN IF NOT EXISTS reminder_sent_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reminder_2h_sent_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_bookings_reminder
  ON bookings.bookings (company_id, starts_at)
  WHERE reminder_sent_at IS NULL
    AND status IN ('pending', 'confirmed');

CREATE INDEX IF NOT EXISTS idx_bookings_reminder_2h
  ON bookings.bookings (company_id, starts_at)
  WHERE reminder_2h_sent_at IS NULL
    AND status IN ('pending', 'confirmed');
