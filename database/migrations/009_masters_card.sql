-- 009_masters_card.sql
-- Расширяет salons.masters для полной карточки сотрудника как в DIKIDI:
-- 4 таба (Профиль / График / Схемы ЗП / Доступ).
-- Колонки разнесены на first_name + last_name (display_name остаётся как computed/legacy).

SET search_path TO salons, public;

ALTER TABLE masters
  ADD COLUMN IF NOT EXISTS first_name        TEXT,
  ADD COLUMN IF NOT EXISTS last_name         TEXT,
  ADD COLUMN IF NOT EXISTS position          TEXT,                       -- должность («админ», «врач-косметолог», «менеджер»)
  ADD COLUMN IF NOT EXISTS category          TEXT,                       -- категория («Администратор», «Косметолог», «Стилист»…)
  ADD COLUMN IF NOT EXISTS phone             TEXT,
  ADD COLUMN IF NOT EXISTS email             CITEXT,
  ADD COLUMN IF NOT EXISTS notes             TEXT,                       -- «сведения о сотруднике»
  ADD COLUMN IF NOT EXISTS provides_services BOOLEAN NOT NULL DEFAULT TRUE,  -- «оказывает услуги»
  ADD COLUMN IF NOT EXISTS dismissed_at      TIMESTAMPTZ;                -- если уволен (вместо или плюс к is_active)

-- Best-effort заполнение first_name/last_name из существующего display_name
-- (формат «Фамилия Имя» доминирует в наблюдённой базе).
UPDATE masters
SET
  last_name  = COALESCE(last_name,  split_part(display_name, ' ', 1)),
  first_name = COALESCE(first_name, NULLIF(trim(substring(display_name FROM position(' ' IN display_name) + 1)), ''))
WHERE first_name IS NULL OR last_name IS NULL;

-- Индексы для поиска по фамилии/телефону
CREATE INDEX IF NOT EXISTS idx_masters_last_name
  ON masters(company_id, last_name) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_masters_phone
  ON masters(company_id, phone) WHERE phone IS NOT NULL;
