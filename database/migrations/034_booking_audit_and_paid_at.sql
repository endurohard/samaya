-- 034_booking_audit_and_paid_at.sql
--
-- 1) paid_at. Фронтенд рисует вторую галочку («оплачено») по полю paid_at,
--    но колонки не существовало — признак оплаты не показывался никогда.
--
-- 2) booking_audit. История изменений записи: кто, когда и что поменял.
--    Нужна и для разбора спорных ситуаций («кто снизил цену»), и потому что
--    редактирование записи теперь меняет деньги — цену, скидку, состав услуг.

SET search_path TO bookings;

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

-- Уже завершённые записи считаем оплаченными в момент завершения, иначе после
-- релиза они выглядели бы неоплаченными.
UPDATE bookings
   SET paid_at = completed_at
 WHERE status = 'completed' AND paid_at IS NULL AND completed_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS booking_audit (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL,
  booking_id  UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  actor_id    UUID,           -- users.users.id; NULL для системных действий
  actor_name  TEXT,           -- снимок имени: пользователя могут удалить
  actor_role  TEXT,
  action      TEXT NOT NULL,  -- created | updated | canceled | completed | no_show
  changes     JSONB NOT NULL DEFAULT '{}'::jsonb,  -- { field: {from, to} }
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_booking_audit_booking
  ON booking_audit (booking_id, created_at DESC);
