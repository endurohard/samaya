-- 016_bonus_program.sql
-- Бонусная программа: хранение расхода и начисления бонусов в самой записи.

ALTER TABLE bookings.bookings
  ADD COLUMN IF NOT EXISTS bonus_spend   NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bonus_accrual NUMERIC(10,2) NOT NULL DEFAULT 0;

-- Настройки бонусной программы хранятся в salons.company_profile.settings_jsonb->>'bonus'
-- { "accrual_rate": 5, "max_spend_pct": 30, "enabled": true }
-- Это позволяет менять настройки из любого устройства.
