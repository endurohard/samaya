-- 001_users.sql
-- Таблицы для user-service: companies, users, refresh_tokens.
-- Все таблицы содержат company_id (multi-tenant с первого дня — см. ADR-001).

-- public нужен для типов из extensions (citext, uuid-ossp), которые создаются в public.
SET search_path TO users, public;

CREATE TABLE IF NOT EXISTS companies (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug        CITEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  email         CITEXT,
  phone         TEXT,
  password_hash TEXT NOT NULL,
  full_name     TEXT,
  role          TEXT NOT NULL DEFAULT 'client'
                CHECK (role IN ('owner', 'admin', 'master', 'client')),
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT users_email_or_phone CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

-- Уникальность email/phone в рамках компании (partial — игнорим NULL)
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_company_email
  ON users (company_id, email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_company_phone
  ON users (company_id, phone) WHERE phone IS NOT NULL;

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,        -- SHA256 hex
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  user_agent  TEXT,
  ip          INET,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_user_active
  ON refresh_tokens (user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_refresh_expires_active
  ON refresh_tokens (expires_at) WHERE revoked_at IS NULL;

-- Триггер updated_at
CREATE OR REPLACE FUNCTION users.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION users.set_updated_at();

DROP TRIGGER IF EXISTS trg_companies_updated_at ON companies;
CREATE TRIGGER trg_companies_updated_at
  BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION users.set_updated_at();

-- Сид компании Samaya. Детерминированный UUID удобен в dev (env DEFAULT_COMPANY_ID).
INSERT INTO companies (id, slug, name)
VALUES ('00000000-0000-0000-0000-000000000001', 'samaya', 'Самая')
ON CONFLICT (slug) DO NOTHING;
