-- 032_time_blocks.sql
-- «Занятое время» мастера: перерыв, обучение, личные дела. На эти интервалы
-- нельзя записать клиента ни через админку, ни через публичный виджет.
--
-- Почему отдельная таблица, а не запись в bookings со спец-статусом: блокировка
-- не имеет клиента, услуг и цены, а выборки по bookings кормят выручку, зарплату
-- и аналитику — блокировки протекли бы во все эти отчёты.

SET search_path TO bookings;

CREATE TABLE IF NOT EXISTS time_blocks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL,
  master_id   UUID NOT NULL,
  starts_at   TIMESTAMPTZ NOT NULL,
  ends_at     TIMESTAMPTZ NOT NULL,
  reason      TEXT,
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_time_blocks_master_starts
  ON time_blocks (company_id, master_id, starts_at);

-- Блокировки одного мастера не пересекаются между собой (как и брони).
ALTER TABLE time_blocks DROP CONSTRAINT IF EXISTS time_blocks_no_overlap;
ALTER TABLE time_blocks ADD CONSTRAINT time_blocks_no_overlap
  EXCLUDE USING gist (
    master_id WITH =,
    tstzrange(starts_at, ends_at) WITH &&
  );
