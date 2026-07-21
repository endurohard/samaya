-- 038_audit_paid_edit.sql
--
-- Отдельное действие для правки уже оплаченной записи.
--
-- Такая правка меняет выручку и зарплату задним числом, поэтому владелец
-- должен видеть её отдельным списком, а не искать среди обычных изменений.
-- Классический способ увести деньги — занизить сумму закрытой записи, и без
-- отдельной выборки это незаметно.

SET search_path TO bookings;

ALTER TABLE booking_audit DROP CONSTRAINT IF EXISTS booking_audit_action_check;
ALTER TABLE booking_audit
  ADD CONSTRAINT booking_audit_action_check
  CHECK (action IN ('created', 'updated', 'updated_paid', 'canceled', 'completed', 'no_show'));

CREATE INDEX IF NOT EXISTS idx_booking_audit_paid_edits
  ON booking_audit (company_id, created_at DESC)
  WHERE action = 'updated_paid';
