-- 002_salons.sql
-- Таблицы для salon-service: категории услуг, услуги, мастера, привязки мастер↔услуга, расписание мастеров.

SET search_path TO salons, public;

CREATE TABLE IF NOT EXISTS service_categories (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  UUID NOT NULL,
  name        TEXT NOT NULL,
  sort_order  INT  NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, name)
);
CREATE INDEX IF NOT EXISTS idx_categories_company ON service_categories(company_id);

CREATE TABLE IF NOT EXISTS services (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id        UUID NOT NULL,
  category_id       UUID REFERENCES service_categories(id) ON DELETE SET NULL,
  name              TEXT NOT NULL,
  price             NUMERIC(12, 2) NOT NULL DEFAULT 0,
  duration_minutes  INT NOT NULL DEFAULT 60,
  color             TEXT,
  tech_card_id      UUID,                 -- nullable, заполняется в Phase 0b (inventory-service)
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (duration_minutes > 0),
  CHECK (price >= 0)
);
CREATE INDEX IF NOT EXISTS idx_services_company ON services(company_id);
CREATE INDEX IF NOT EXISTS idx_services_category ON services(category_id) WHERE category_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_services_active ON services(company_id) WHERE is_active = TRUE;

CREATE TABLE IF NOT EXISTS masters (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      UUID NOT NULL,
  user_id         UUID,                   -- ссылка на users.users(id), без FK (schema-per-service); NULL = standalone
  display_name    TEXT NOT NULL,
  specialization  TEXT,
  avatar_url      TEXT,
  sort_order      INT NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_masters_company ON masters(company_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_masters_company_user
  ON masters(company_id, user_id) WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS master_services (
  master_id                 UUID NOT NULL REFERENCES masters(id) ON DELETE CASCADE,
  service_id                UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  custom_price              NUMERIC(12, 2),
  custom_duration_minutes   INT CHECK (custom_duration_minutes IS NULL OR custom_duration_minutes > 0),
  PRIMARY KEY (master_id, service_id)
);
CREATE INDEX IF NOT EXISTS idx_master_services_service ON master_services(service_id);

CREATE TABLE IF NOT EXISTS master_schedules (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  UUID NOT NULL,
  master_id   UUID NOT NULL REFERENCES masters(id) ON DELETE CASCADE,
  work_date   DATE NOT NULL,
  start_time  TIME,
  end_time    TIME,
  is_day_off  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (master_id, work_date),
  CHECK (
    (is_day_off = TRUE  AND start_time IS NULL     AND end_time IS NULL)
    OR
    (is_day_off = FALSE AND start_time IS NOT NULL AND end_time IS NOT NULL AND start_time < end_time)
  )
);
CREATE INDEX IF NOT EXISTS idx_schedules_master_date ON master_schedules(master_id, work_date);
CREATE INDEX IF NOT EXISTS idx_schedules_company_date ON master_schedules(company_id, work_date);

-- Триггер updated_at
CREATE OR REPLACE FUNCTION salons.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['service_categories','services','masters','master_schedules'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_upd ON salons.%I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_upd BEFORE UPDATE ON salons.%I FOR EACH ROW EXECUTE FUNCTION salons.set_updated_at()', t, t);
  END LOOP;
END $$;
