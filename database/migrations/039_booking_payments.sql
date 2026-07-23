-- 039_booking_payments.sql
--
-- Оплата продажи несколькими способами: часть картой, часть наличными,
-- часть сертификатом или с лицевого счёта. Одна колонка payment_method
-- такой состав не выражает — детали уходят в отдельную таблицу, а в records
-- остаётся 'split' как признак составной оплаты.

SET search_path TO bookings;

CREATE TABLE IF NOT EXISTS booking_payments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL,
  booking_id  UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  method      TEXT NOT NULL CHECK (method IN ('cash', 'card', 'online', 'balance', 'certificate')),
  amount      NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_booking_payments_booking
  ON booking_payments (booking_id);

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_payment_method_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_payment_method_check
  CHECK (payment_method IN ('cash', 'card', 'online', 'balance', 'certificate', 'split'));
