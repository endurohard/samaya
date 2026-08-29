-- 050_positions.sql
--
-- Справочник должностей компании.
--
-- Должности были захардкожены в вёрстке формы сотрудника: «Ассистент» в список
-- не добавить, хотя такие сотрудники в клинике есть. Плюс не всякая должность
-- должна занимать колонку в журнале записей — техничка и менеджер по продажам
-- на клиента не записываются, а место в сетке занимали бы.
--
-- Связь с сотрудником по имени, а не по FK на masters.position: колонка уже
-- заполнена строками, и перевод её в position_id потребовал бы миграции данных
-- в карточке, фильтрах журнала и отчётах ради того же самого. Имя уникально в
-- пределах компании без учёта регистра — «ассистент» и «Ассистент» это одна
-- должность, иначе в справочнике заведутся дубли с разными настройками.
--
-- show_in_journal по умолчанию TRUE: должность, заведённая на ходу, ведёт себя
-- как раньше, а скрывать её из журнала — осознанное действие.

SET search_path TO salons, public;

CREATE TABLE IF NOT EXISTS positions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      UUID NOT NULL,
  name            TEXT NOT NULL CHECK (btrim(name) <> ''),
  show_in_journal BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_positions_company_name
  ON positions (company_id, lower(btrim(name)));

-- Сидируем тем, что уже проставлено сотрудникам: иначе справочник открывается
-- пустым, хотя должности в карточках есть, и их пришлось бы вбивать заново.
INSERT INTO positions (company_id, name)
SELECT DISTINCT m.company_id, btrim(m.position)
  FROM salons.masters m
 WHERE m.position IS NOT NULL AND btrim(m.position) <> ''
ON CONFLICT DO NOTHING;

DROP TRIGGER IF EXISTS trg_positions_upd ON salons.positions;
CREATE TRIGGER trg_positions_upd
  BEFORE UPDATE ON salons.positions
  FOR EACH ROW EXECUTE FUNCTION salons.set_updated_at();
