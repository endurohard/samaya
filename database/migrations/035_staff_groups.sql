-- 035_staff_groups.sql
--
-- Группы сотрудников и начисление процента группе с группы услуг.
-- Пример: «2% с категории Лазеры → группе из 3 менеджеров», причём 2% — это
-- сумма на всю группу, которая делится между участниками поровну, а не 2%
-- каждому (иначе расход втрое больше задуманного).
--
-- Расширяем существующую salary.service_commissions, а не заводим новую
-- таблицу: правила начисления должны лежать в одном месте, иначе расчёт
-- зарплаты придётся собирать из двух источников с разными приоритетами.

SET search_path TO salary, public;

CREATE TABLE IF NOT EXISTS staff_groups (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  UUID NOT NULL,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, name)
);

CREATE TABLE IF NOT EXISTS staff_group_members (
  group_id   UUID NOT NULL REFERENCES staff_groups(id) ON DELETE CASCADE,
  master_id  UUID NOT NULL,          -- salons.masters(id), без FK (schema-per-service)
  PRIMARY KEY (group_id, master_id)
);

CREATE INDEX IF NOT EXISTS idx_staff_group_members_master
  ON staff_group_members (master_id);

ALTER TABLE service_commissions
  -- Правило на всю категорию услуг (salons.service_categories).
  ADD COLUMN IF NOT EXISTS category_id     UUID,
  -- Кому начисляем. NULL — прежнее поведение: всем с in_commission_pool.
  ADD COLUMN IF NOT EXISTS staff_group_id  UUID REFERENCES staff_groups(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_svc_comm_category
  ON service_commissions (company_id, category_id);
