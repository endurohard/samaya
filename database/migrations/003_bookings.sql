-- 003_bookings.sql
-- Таблицы для booking-service: bookings, booking_services (snapshot услуг), booking_events_outbox.
-- Главная защита от double-booking — EXCLUDE USING gist на пересечение временных диапазонов.

CREATE EXTENSION IF NOT EXISTS btree_gist;

SET search_path TO bookings, public;

CREATE TABLE IF NOT EXISTS bookings (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      UUID NOT NULL,
  master_id       UUID NOT NULL,                 -- ref salons.masters(id), без FK (schema-per-service)
  client_id       UUID,                          -- ref clients (Phase 0a iteration), пока nullable
  client_phone    TEXT,
  client_name     TEXT,
  starts_at       TIMESTAMPTZ NOT NULL,
  ends_at         TIMESTAMPTZ NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'confirmed', 'completed', 'canceled', 'no_show')),
  notes           TEXT,
  total_price     NUMERIC(12, 2) NOT NULL DEFAULT 0,
  source          TEXT NOT NULL DEFAULT 'admin'
                  CHECK (source IN ('admin', 'master', 'public_widget')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  canceled_at     TIMESTAMPTZ,
  cancel_reason   TEXT,
  completed_at    TIMESTAMPTZ,
  CHECK (ends_at > starts_at),
  CHECK (client_phone IS NOT NULL OR client_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_bookings_master_starts ON bookings(master_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_bookings_company_starts ON bookings(company_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_bookings_active ON bookings(company_id, master_id, starts_at)
  WHERE status IN ('pending', 'confirmed');
CREATE INDEX IF NOT EXISTS idx_bookings_client ON bookings(company_id, client_id)
  WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bookings_phone ON bookings(company_id, client_phone)
  WHERE client_phone IS NOT NULL;

-- Защита от двойного бронирования: одного мастера нельзя записать на пересекающиеся
-- временные интервалы среди активных (pending/confirmed) записей.
-- При попытке INSERT с конфликтом Postgres вернёт код 23P01 (exclusion_violation).
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_no_overlap;
ALTER TABLE bookings ADD CONSTRAINT bookings_no_overlap
  EXCLUDE USING gist (
    master_id WITH =,
    tstzrange(starts_at, ends_at) WITH &&
  ) WHERE (status IN ('pending', 'confirmed'));

CREATE TABLE IF NOT EXISTS booking_services (
  booking_id        UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  service_id        UUID NOT NULL,            -- snapshot id (без FK, schema-per-service)
  service_name      TEXT NOT NULL,            -- snapshot названия (на момент бронирования)
  price             NUMERIC(12, 2) NOT NULL,  -- snapshot цены
  duration_minutes  INT NOT NULL CHECK (duration_minutes > 0),
  sort_order        INT NOT NULL DEFAULT 0,
  PRIMARY KEY (booking_id, service_id)
);

-- Outbox-таблица для событий жизненного цикла записи.
-- В Phase 0a таблица заполняется в той же транзакции, что и сама запись (at-least-once).
-- Воркер-публишер (RabbitMQ/Redis) будет в Phase 0b — на её событиях inventory-service
-- спишет расходники по техкартам услуг.
CREATE TABLE IF NOT EXISTS booking_events_outbox (
  id            BIGSERIAL PRIMARY KEY,
  event_type    TEXT NOT NULL,            -- booking.created | booking.confirmed | booking.completed | booking.canceled
  booking_id    UUID NOT NULL,
  company_id    UUID NOT NULL,
  payload       JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at  TIMESTAMPTZ               -- NULL = не опубликовано
);
CREATE INDEX IF NOT EXISTS idx_outbox_unpublished
  ON booking_events_outbox(created_at) WHERE published_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_outbox_booking ON booking_events_outbox(booking_id);

-- Триггер updated_at
CREATE OR REPLACE FUNCTION bookings.set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bookings_upd ON bookings;
CREATE TRIGGER trg_bookings_upd BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION bookings.set_updated_at();
