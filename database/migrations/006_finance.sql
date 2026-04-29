-- 006_finance.sql
-- finance-service: счета/кассы, категории cashflow, контрагенты, журнал операций.
-- Связи с другими сервисами без FK (schema-per-service): created_by_user_id ссылается
-- на users.users(id), payouts из salary-service ссылаются на finance.operations(id).

CREATE SCHEMA IF NOT EXISTS finance;
SET search_path TO finance, public;

-- ===== accounts =====
CREATE TABLE IF NOT EXISTS accounts (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id          UUID NOT NULL,
  name                TEXT NOT NULL,
  type                TEXT NOT NULL DEFAULT 'cash'
                      CHECK (type IN ('cash', 'bank', 'personal', 'other')),
  initial_balance     NUMERIC(14, 2) NOT NULL DEFAULT 0,
  current_balance     NUMERIC(14, 2) NOT NULL DEFAULT 0,    -- maintained by service inside TX
  responsible_user_id UUID,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, name)
);

CREATE INDEX IF NOT EXISTS idx_accounts_company_active
  ON accounts(company_id) WHERE is_active = TRUE;

-- ===== cashflow_categories =====
-- Статьи доходов/расходов. Owner может добавлять кастомные.
CREATE TABLE IF NOT EXISTS cashflow_categories (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  UUID NOT NULL,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('income', 'expense')),
  sort_order  INTEGER NOT NULL DEFAULT 100,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, name, kind)
);

CREATE INDEX IF NOT EXISTS idx_cat_company_kind
  ON cashflow_categories(company_id, kind) WHERE is_active = TRUE;

-- ===== counterparties =====
CREATE TABLE IF NOT EXISTS counterparties (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  UUID NOT NULL,
  name        TEXT NOT NULL,
  inn         TEXT,
  kind        TEXT NOT NULL DEFAULT 'other'
              CHECK (kind IN ('supplier', 'customer', 'employee', 'other')),
  phone       TEXT,
  email       CITEXT,
  notes       TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, name)
);

CREATE INDEX IF NOT EXISTS idx_cp_company_active
  ON counterparties(company_id) WHERE is_active = TRUE;

-- ===== operations =====
-- Журнал операций. transfer создаёт две связанные строки с одинаковым transfer_group_id.
-- Soft-delete через is_deleted (audit trail для финансов критичен).
CREATE TABLE IF NOT EXISTS operations (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id          UUID NOT NULL,
  account_id          UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  kind                TEXT NOT NULL
                      CHECK (kind IN ('income', 'expense', 'transfer_out', 'transfer_in', 'adjust')),
  category_id         UUID REFERENCES cashflow_categories(id) ON DELETE SET NULL,
  counterparty_id     UUID REFERENCES counterparties(id) ON DELETE SET NULL,
  amount              NUMERIC(14, 2) NOT NULL CHECK (amount >= 0),
  op_date             DATE NOT NULL,
  note                TEXT,
  transfer_group_id   UUID,                                 -- связывает две transfer_in/transfer_out
  created_by_user_id  UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_deleted          BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ops_company_date
  ON operations(company_id, op_date DESC) WHERE is_deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_ops_account_date
  ON operations(account_id, op_date DESC) WHERE is_deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_ops_transfer_group
  ON operations(transfer_group_id) WHERE transfer_group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ops_category
  ON operations(category_id) WHERE category_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ops_counterparty
  ON operations(counterparty_id) WHERE counterparty_id IS NOT NULL;

-- ===== triggers =====
CREATE OR REPLACE FUNCTION finance.set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_accounts_upd ON accounts;
CREATE TRIGGER trg_accounts_upd BEFORE UPDATE ON accounts
  FOR EACH ROW EXECUTE FUNCTION finance.set_updated_at();

DROP TRIGGER IF EXISTS trg_cp_upd ON counterparties;
CREATE TRIGGER trg_cp_upd BEFORE UPDATE ON counterparties
  FOR EACH ROW EXECUTE FUNCTION finance.set_updated_at();

-- ===== seed default categories =====
-- Базовый набор статей. Owner может удалить ненужные и добавить свои через UI.
-- Применяется ко всем существующим компаниям через subquery.
INSERT INTO cashflow_categories (company_id, name, kind, sort_order)
SELECT c.id, v.name, v.kind, v.sort_order
FROM users.companies c
CROSS JOIN (VALUES
  ('Касса',         'income',  10),
  ('Эквайринг',     'income',  20),
  ('Прочее',        'income', 100),
  ('Аренда',        'expense', 10),
  ('Зарплата',      'expense', 20),
  ('Расходники',    'expense', 30),
  ('Реклама',       'expense', 40),
  ('Прочее',        'expense', 100)
) AS v(name, kind, sort_order)
ON CONFLICT (company_id, name, kind) DO NOTHING;
