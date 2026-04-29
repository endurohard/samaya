-- 008_salary.sql
-- salary-service: версионированные схемы расчёта, журнал начислений, выплаты.
-- Связи без FK (schema-per-service):
--   - schemes.master_id → salons.masters(id)
--   - accruals.source_booking_id → bookings.bookings(id) (для авто-начислений)
--   - payouts.finance_operation_id → finance.operations(id) (saga при выплате)

CREATE SCHEMA IF NOT EXISTS salary;
SET search_path TO salary, public;

-- ===== schemes =====
-- Схема расчёта мастера. Версионирование: новая схема для master_id автоматически
-- закрывает effective_to = new.effective_from - 1 у предыдущей. Перекрытие диапазонов
-- запрещено EXCLUDE-ограничением.
CREATE TABLE IF NOT EXISTS schemes (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id          UUID NOT NULL,
  master_id           UUID NOT NULL,
  scheme_type         TEXT NOT NULL
                      CHECK (scheme_type IN ('rate', 'rate_plus_percent', 'percent_only')),
  rate_amount         NUMERIC(12, 2) NOT NULL DEFAULT 0,
  rate_period         TEXT NOT NULL DEFAULT 'month'
                      CHECK (rate_period IN ('day', 'week', 'month')),
  percent_services    NUMERIC(5, 2) NOT NULL DEFAULT 0
                      CHECK (percent_services >= 0 AND percent_services <= 100),
  percent_goods       NUMERIC(5, 2) NOT NULL DEFAULT 0
                      CHECK (percent_goods >= 0 AND percent_goods <= 100),
  apply_discount      BOOLEAN NOT NULL DEFAULT FALSE,
  guaranteed          NUMERIC(12, 2) NOT NULL DEFAULT 0,
  effective_from      DATE NOT NULL,
  effective_to        DATE,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  -- Запрет перекрытия активных диапазонов одного мастера.
  -- daterange закрытый-открытый '[)', верхняя граница = COALESCE(effective_to + 1, infinity).
  EXCLUDE USING gist (
    master_id WITH =,
    daterange(effective_from,
              COALESCE(effective_to + INTERVAL '1 day', 'infinity'::date)::date,
              '[)') WITH &&
  )
);

CREATE INDEX IF NOT EXISTS idx_schemes_master_eff
  ON schemes(master_id, effective_from DESC);
CREATE INDEX IF NOT EXISTS idx_schemes_company
  ON schemes(company_id);

-- ===== accruals =====
-- Append-only журнал начислений. source_kind = 'auto_calc' идемпотентен через
-- UNIQUE(source_booking_id) — не начислим дважды за одну запись.
CREATE TABLE IF NOT EXISTS accruals (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id          UUID NOT NULL,
  master_id           UUID NOT NULL,
  amount              NUMERIC(12, 2) NOT NULL,
  period_from         DATE,
  period_to           DATE,
  source_kind         TEXT NOT NULL DEFAULT 'auto_calc'
                      CHECK (source_kind IN ('auto_calc', 'bonus', 'penalty', 'manual')),
  source              TEXT,
  source_booking_id   UUID,
  note                TEXT,
  created_by_user_id  UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_accr_master_period
  ON accruals(master_id, period_to DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_accr_company_created
  ON accruals(company_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_accr_auto_booking
  ON accruals(source_booking_id) WHERE source_kind = 'auto_calc' AND source_booking_id IS NOT NULL;

-- ===== payouts =====
-- Выплаты мастеру. status='pending' → создаём операцию в finance → 'posted'.
-- Если finance call упал — остаётся 'pending', можно повторить.
CREATE TABLE IF NOT EXISTS payouts (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id            UUID NOT NULL,
  master_id             UUID NOT NULL,
  amount                NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  paid_on               DATE NOT NULL,
  finance_operation_id  UUID,
  status                TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'posted', 'failed')),
  failure_reason        TEXT,
  note                  TEXT,
  created_by_user_id    UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  posted_at             TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_payout_master
  ON payouts(master_id, paid_on DESC);
CREATE INDEX IF NOT EXISTS idx_payout_status
  ON payouts(company_id, status, created_at DESC) WHERE status != 'posted';
