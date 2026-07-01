-- 023_client_balance.sql
-- Лицевой счёт клиента: баланс (депозит) для пополнения и списания за услуги
-- + журнал операций баланса. Пополнение опционально пишется в finance (касса).
-- Это НЕ бонусы (bonus_balance) — отдельный «реальный» депозит.

SET search_path TO public;

ALTER TABLE clients.clients
  ADD COLUMN IF NOT EXISTS balance NUMERIC(12, 2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS clients.balance_operations (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      UUID NOT NULL,
  client_id       UUID NOT NULL REFERENCES clients.clients(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('topup', 'charge', 'refund', 'adjust')),
  amount          NUMERIC(12, 2) NOT NULL,   -- модуль суммы; знак определяется kind
  payment_method  TEXT CHECK (payment_method IN ('cash', 'cashless')),
  finance_op_id   UUID,                       -- ссылка на finance.operations (если писали в кассу)
  booking_id      UUID,                       -- для будущего списания за услугу
  note            TEXT,
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_balance_ops_client
  ON clients.balance_operations(company_id, client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_balance_ops_topup
  ON clients.balance_operations(company_id, created_at) WHERE kind = 'topup';
