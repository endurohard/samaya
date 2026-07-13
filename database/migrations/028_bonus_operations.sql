-- 028_bonus_operations.sql
-- Журнал операций бонусного счёта клиента (clients.clients.bonus_balance).
-- До этой миграции bonus_spend/bonus_accrual писались только в строку записи,
-- а сам bonus_balance не менялся — бонусы были нерабочими. Теперь при оформлении
-- продажи баланс двигается атомарно и каждое изменение фиксируется здесь.

SET search_path TO public;

CREATE TABLE IF NOT EXISTS clients.bonus_operations (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id   UUID NOT NULL,
  client_id    UUID NOT NULL REFERENCES clients.clients(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('spend', 'accrual', 'adjust')),
  amount       NUMERIC(12, 2) NOT NULL,   -- модуль суммы; знак определяется kind
  booking_id   UUID,                       -- запись, при оформлении которой изменился баланс
  note         TEXT,
  created_by   UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bonus_ops_client
  ON clients.bonus_operations(company_id, client_id, created_at DESC);

-- Идемпотентность оформления продажи: одна операция каждого вида на запись.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bonus_ops_booking_kind
  ON clients.bonus_operations(booking_id, kind) WHERE booking_id IS NOT NULL;
