-- 005_clients.sql
-- Таблица clients (CRM-минимум). Сегменты (regular/sleeping/missing/never/new/blocked/deleted)
-- считаются на лету в client-service через JOIN с bookings.bookings.
-- Никаких внешних FK на bookings — schema-per-service, связь по (company_id, phone | client_id).

SET search_path TO clients, public;

CREATE TABLE IF NOT EXISTS clients (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      UUID NOT NULL,
  phone           CITEXT NOT NULL,                          -- E.164 или локальный, валидируется в сервисе
  full_name       TEXT NOT NULL,
  birthday        DATE,
  gender          TEXT CHECK (gender IN ('male', 'female')),
  email           CITEXT,
  comment         TEXT,                                     -- заметка администратора
  source          TEXT NOT NULL DEFAULT 'admin'
                  CHECK (source IN ('admin', 'public_widget', 'import', 'master')),
  avatar_color    TEXT NOT NULL DEFAULT '#94a3b8',          -- hex для цветного круга в списке
  bonus_balance   NUMERIC(12, 2) NOT NULL DEFAULT 0,
  is_blocked      BOOLEAN NOT NULL DEFAULT FALSE,           -- "Заблокированы" в сайдбаре DIKIDI
  is_deleted      BOOLEAN NOT NULL DEFAULT FALSE,           -- soft-delete, попадает в "Удалены"
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, phone)
);

CREATE INDEX IF NOT EXISTS idx_clients_company_active
  ON clients(company_id) WHERE is_deleted = FALSE;
CREATE INDEX IF NOT EXISTS idx_clients_company_blocked
  ON clients(company_id) WHERE is_blocked = TRUE AND is_deleted = FALSE;
-- Поиск по имени/телефону (LIKE '%...%') через trigram
CREATE INDEX IF NOT EXISTS idx_clients_name_trgm
  ON clients USING gin (full_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_clients_phone_trgm
  ON clients USING gin (phone gin_trgm_ops);

-- Триггер updated_at
CREATE OR REPLACE FUNCTION clients.set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_clients_upd ON clients;
CREATE TRIGGER trg_clients_upd BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION clients.set_updated_at();
