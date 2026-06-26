-- 022_user_permissions.sql
-- RBAC фаза 1: точечные права доступа сотрудника поверх роли.
-- permissions = JSONB-карта { "clients.view": true, "finance.manage": false, ... }.
-- NULL → действуют дефолты роли (см. user-service/src/permissions.ts).
-- Эффективные права = дефолты роли, перекрытые значениями из permissions.

SET search_path TO public;

ALTER TABLE users.users
  ADD COLUMN IF NOT EXISTS permissions JSONB;
