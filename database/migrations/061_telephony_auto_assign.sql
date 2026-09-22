-- Автопривязка внутренних номеров к менеджерам по графику работы.
--
-- Было: номер закреплялся за сотрудником навсегда (extension_links.master_id).
-- Менеджеры работают посменно, поэтому вручную переставлять привязку пришлось
-- бы каждый день, а звонки утром уходили бы на фамилию вчерашней смены.
--
-- Стало: номер помечается как «раздаётся автоматически», и каждое утро он
-- достаётся тому, кто вышел в смену. Порядок раздачи — по времени начала
-- смены: первый пришедший получает меньший номер (1001), следующий 1002.
--
-- Ручная привязка никуда не делась: auto = FALSE оставляет номер закреплённым
-- за конкретным человеком. Это нужно для 1004 «Stacionar» — стационарного
-- аппарата, который к смене не относится.

ALTER TABLE telephony.extension_links
  ADD COLUMN IF NOT EXISTS auto BOOLEAN NOT NULL DEFAULT FALSE;

-- Должности, которые участвуют в раздаче. Косметологи и врачи на ресепшене не
-- сидят — им внутренний номер не нужен, иначе звонки клиентов уходили бы
-- человеку в процедурном кабинете.
CREATE TABLE IF NOT EXISTS telephony.auto_assign_positions (
  company_id UUID NOT NULL,
  position   TEXT NOT NULL,
  PRIMARY KEY (company_id, position)
);

-- Кто занимал номер в конкретный день: нужно, чтобы в журнале звонков за
-- прошлую неделю осталась фамилия того, кто реально говорил, а не текущей
-- смены. Без этой таблицы вчерашние звонки «переезжали» бы на нового
-- владельца номера при каждой пересменке.
CREATE TABLE IF NOT EXISTS telephony.extension_assignments (
  company_id UUID NOT NULL,
  extension  TEXT NOT NULL,
  work_date  DATE NOT NULL,
  master_id  UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, extension, work_date)
);

CREATE INDEX IF NOT EXISTS idx_ext_assign_date
  ON telephony.extension_assignments(company_id, work_date);

COMMENT ON COLUMN telephony.extension_links.auto IS
  'TRUE — номер раздаётся по графику смен; FALSE — закреплён за сотрудником вручную.';
COMMENT ON TABLE telephony.auto_assign_positions IS
  'Должности, участвующие в автораздаче номеров (менеджеры и администраторы ресепшна).';
COMMENT ON TABLE telephony.extension_assignments IS
  'История: какой номер за каким сотрудником был закреплён в конкретный день.';

-- Должности по умолчанию — те, что реально сидят на ресепшене.
-- Список правится в интерфейсе, здесь только стартовое наполнение.
INSERT INTO telephony.auto_assign_positions (company_id, position)
SELECT DISTINCT m.company_id, m.position
  FROM salons.masters m
 WHERE m.position IN ('Администратор', 'Менеджер по продажам')
ON CONFLICT DO NOTHING;
