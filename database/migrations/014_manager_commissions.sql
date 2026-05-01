-- 014_manager_commissions.sql
-- Комиссии менеджеров за услуги + поддержка техничек в расчёте ЗП.

SET search_path TO public;

-- ── 1. manager_id в записях ──────────────────────────────────────────────────
-- Менеджер (мастер с provides_services=false или позицией 'Менеджер'), оформивший запись.
ALTER TABLE bookings.bookings
  ADD COLUMN IF NOT EXISTS manager_id UUID;

CREATE INDEX IF NOT EXISTS idx_bookings_manager
  ON bookings.bookings (company_id, manager_id)
  WHERE manager_id IS NOT NULL;

-- ── 2. Правила комиссий по услугам ───────────────────────────────────────────
-- commission_type='percent': amount = % от стоимости услуги
-- commission_type='fixed':   amount = фиксированная сумма за каждую услугу в записи
CREATE TABLE IF NOT EXISTS salary.service_commissions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      UUID NOT NULL,
  service_id      UUID,                -- NULL = применяется ко всем услугам
  commission_type TEXT NOT NULL DEFAULT 'percent'
                  CHECK (commission_type IN ('percent', 'fixed')),
  amount          NUMERIC(10, 2) NOT NULL CHECK (amount >= 0),
  effective_from  DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to    DATE,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_svc_comm_company
  ON salary.service_commissions (company_id, service_id);

-- ── 3. Расширяем source_kind начислений ──────────────────────────────────────
ALTER TABLE salary.accruals DROP CONSTRAINT IF EXISTS accruals_source_kind_check;
ALTER TABLE salary.accruals ADD CONSTRAINT accruals_source_kind_check
  CHECK (source_kind IN ('auto_calc', 'bonus', 'penalty', 'manual', 'manager_commission'));
