-- 049_assistant_assignments.sql
--
-- Прикрепление ассистента к врачу на конкретную дату.
--
-- Ассистент не оказывает услуги сам: в журнале у него нет колонки, записи на
-- него не ставят. Но выходит он не «в клинику вообще», а к конкретному врачу —
-- сегодня к одному, завтра к другому, и на этом же держится оплата за выход.
-- Хранить это в самой смене (master_schedules) нельзя: смена описывает часы, а
-- прикрепление — отношение двух сотрудников, и у врача за день ассистентов
-- может быть несколько.
--
-- UNIQUE (assistant_id, work_date): в один день ассистент помогает одному
-- врачу. Пересменка «до обеда с одним, после — с другим» здесь не выражается
-- намеренно: в графике день — минимальная единица, и половинки дня сломали бы
-- и подсчёт выходов в зарплате.
--
-- ON DELETE CASCADE на обе стороны: уволенного сотрудника удаляют вместе со
-- сменами, и висящие прикрепления показывали бы в графике пустое имя.

SET search_path TO salons, public;

CREATE TABLE IF NOT EXISTS assistant_assignments (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id    UUID NOT NULL,
  work_date     DATE NOT NULL,
  assistant_id  UUID NOT NULL REFERENCES masters(id) ON DELETE CASCADE,
  master_id     UUID NOT NULL REFERENCES masters(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (assistant_id, work_date),
  CHECK (assistant_id <> master_id)
);

CREATE INDEX IF NOT EXISTS idx_assist_company_date
  ON assistant_assignments(company_id, work_date);
CREATE INDEX IF NOT EXISTS idx_assist_master_date
  ON assistant_assignments(master_id, work_date);

DROP TRIGGER IF EXISTS trg_assistant_assignments_upd ON salons.assistant_assignments;
CREATE TRIGGER trg_assistant_assignments_upd
  BEFORE UPDATE ON salons.assistant_assignments
  FOR EACH ROW EXECUTE FUNCTION salons.set_updated_at();
