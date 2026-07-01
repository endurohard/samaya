-- 024_payment_from_balance.sql
-- Оплата услуги списанием с лицевого счёта клиента: добавляем способ оплаты 'balance'.

SET search_path TO public;

ALTER TABLE bookings.bookings DROP CONSTRAINT IF EXISTS bookings_payment_method_check;
ALTER TABLE bookings.bookings
  ADD CONSTRAINT bookings_payment_method_check
  CHECK (payment_method IN ('cash', 'card', 'online', 'balance'));
