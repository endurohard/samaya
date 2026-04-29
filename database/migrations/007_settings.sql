-- 007_settings.sql
-- Расширяет salon-service: профиль компании + шаблоны графика работы.
-- Под раздел Настройки (5 sub-tab: Компания / Услуги / Мастера / Шаблоны графика / Уведомления).

SET search_path TO salons, public;

-- ===== company_profile =====
-- Одна строка на компанию. Расширяет users.companies (там name + slug).
-- Тут — публичный профиль для виджета записи и настройки уведомлений.
CREATE TABLE IF NOT EXISTS company_profile (
  company_id      UUID PRIMARY KEY,
  name            TEXT,
  address         TEXT,
  phone           TEXT,
  email           CITEXT,
  website         TEXT,
  default_open    TIME NOT NULL DEFAULT '10:00',
  default_close   TIME NOT NULL DEFAULT '20:00',
  timezone        TEXT NOT NULL DEFAULT 'Europe/Moscow',
  logo_url        TEXT,
  description     TEXT,
  -- Настройки уведомлений и интеграций как JSONB
  -- (WA-напоминания, SMS, Telegram, эквайринг — будут добавляться по мере реализации).
  settings_jsonb  JSONB NOT NULL DEFAULT '{}',
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_company_profile_upd ON company_profile;
CREATE TRIGGER trg_company_profile_upd BEFORE UPDATE ON company_profile
  FOR EACH ROW EXECUTE FUNCTION salons.set_updated_at();

-- ===== schedule_templates =====
-- Именованные шаблоны рабочих часов. Используются в График работы для bulk-применения.
-- dow_mask — bitmap дней недели (Mon=1, Tue=2, Wed=4, Thu=8, Fri=16, Sat=32, Sun=64).
CREATE TABLE IF NOT EXISTS schedule_templates (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  UUID NOT NULL,
  name        TEXT NOT NULL,
  start_time  TIME NOT NULL,
  end_time    TIME NOT NULL,
  dow_mask    SMALLINT NOT NULL DEFAULT 127,    -- 127 = все 7 дней
  is_default  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, name),
  CHECK (end_time > start_time),
  CHECK (dow_mask >= 0 AND dow_mask <= 127)
);

CREATE INDEX IF NOT EXISTS idx_tmpl_company
  ON schedule_templates(company_id);

DROP TRIGGER IF EXISTS trg_schedule_templates_upd ON schedule_templates;
CREATE TRIGGER trg_schedule_templates_upd BEFORE UPDATE ON schedule_templates
  FOR EACH ROW EXECUTE FUNCTION salons.set_updated_at();

-- ===== seed default company_profile =====
-- Создаём пустую строку для каждой существующей компании, если её ещё нет.
INSERT INTO company_profile (company_id, name)
SELECT c.id, c.name
FROM users.companies c
LEFT JOIN company_profile cp ON cp.company_id = c.id
WHERE cp.company_id IS NULL;

-- ===== seed default schedule_template =====
-- Стандартный «10:00 – 20:00 ежедневно» как первый шаблон каждой компании.
INSERT INTO schedule_templates (company_id, name, start_time, end_time, dow_mask, is_default)
SELECT c.id, 'Стандартный (10–20)', '10:00', '20:00', 127, TRUE
FROM users.companies c
WHERE NOT EXISTS (
  SELECT 1 FROM schedule_templates t
  WHERE t.company_id = c.id AND t.name = 'Стандартный (10–20)'
);
