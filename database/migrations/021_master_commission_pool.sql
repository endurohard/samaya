-- 021_master_commission_pool.sql
-- Участие сотрудника в % пуле менеджерских комиссий.
-- Колонка использовалась кодом salon-service (GET/PATCH /api/salons/masters) и
-- фронтом (тумблер «в пуле»), но миграция отсутствовала — на свежей БД GET /masters
-- падал с "column m.in_commission_pool does not exist". Дефолт FALSE: новый сотрудник
-- в пул не попадает автоматически (opt-in через тумблер в админке).

SET search_path TO public;

ALTER TABLE salons.masters
  ADD COLUMN IF NOT EXISTS in_commission_pool BOOLEAN NOT NULL DEFAULT FALSE;
