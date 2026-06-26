-- 020_notification_outbox.sql
-- Очередь исходящих уведомлений (WA + email) с ретраями.
-- Заменяет fire-and-forget setImmediate в booking-service: запись о записи и
-- постановка уведомлений в очередь идут в одной транзакции (at-least-once),
-- воркер разбирает очередь с экспоненциальным backoff. Паттерн — как у
-- inventory-service по booking_events_outbox (FOR UPDATE SKIP LOCKED).

CREATE TABLE IF NOT EXISTS bookings.notification_outbox (
  id              BIGSERIAL PRIMARY KEY,
  company_id      UUID        NOT NULL,
  channel         TEXT        NOT NULL CHECK (channel IN ('wa', 'email')),
  recipient       TEXT        NOT NULL,          -- телефон (wa) или email
  -- payload: wa → { message }, email → { subject, html }
  payload         JSONB       NOT NULL,
  -- логическая группа/тип для дедупликации и наблюдаемости
  kind            TEXT        NOT NULL,          -- booking_confirmation | owner_new_booking | master_new_booking
  source_id       UUID,                          -- booking_id и т.п.
  status          TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  attempts        INT         NOT NULL DEFAULT 0,
  max_attempts    INT         NOT NULL DEFAULT 5,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at         TIMESTAMPTZ
);

-- Воркер выбирает готовые к отправке (pending + наступило время попытки)
CREATE INDEX IF NOT EXISTS idx_notif_due
  ON bookings.notification_outbox (next_attempt_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_notif_source
  ON bookings.notification_outbox (source_id);
