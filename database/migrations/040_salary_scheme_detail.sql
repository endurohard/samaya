-- 040_salary_scheme_detail.sql
--
-- Схема зарплаты в объёме DIKIDI:
--   1) percent_company — процент от продаж всей компании за период;
--   2) percent_created — процент от записей, которые сотрудник оформил
--      (менеджер/администратор), считается по manager_id записи;
--   3) master_service_rates — пер-услуга переопределение вознаграждения
--      мастера: свой процент ИЛИ фиксированная сумма за услугу. Услуги с
--      переопределением исключаются из общей базы percent_services, иначе
--      вознаграждение задваивается.

SET search_path TO salary, public;

ALTER TABLE schemes
  ADD COLUMN IF NOT EXISTS percent_company NUMERIC(5,2) NOT NULL DEFAULT 0
    CHECK (percent_company >= 0 AND percent_company <= 100),
  ADD COLUMN IF NOT EXISTS percent_created NUMERIC(5,2) NOT NULL DEFAULT 0
    CHECK (percent_created >= 0 AND percent_created <= 100);

CREATE TABLE IF NOT EXISTS master_service_rates (
  company_id   UUID NOT NULL,
  master_id    UUID NOT NULL,   -- salons.masters(id), без FK (schema-per-service)
  service_id   UUID NOT NULL,   -- salons.services(id)
  percent      NUMERIC(5,2) CHECK (percent >= 0 AND percent <= 100),
  fixed_amount NUMERIC(12,2) CHECK (fixed_amount >= 0),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (master_id, service_id),
  -- Пустая строка (без процента и без ставки) не имеет смысла — такие просто
  -- удаляются, а не хранятся.
  CHECK (percent IS NOT NULL OR fixed_amount IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_msr_company ON master_service_rates (company_id, master_id);
