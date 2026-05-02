-- 018_reviews.sql
-- Отзывы клиентов: оценка + комментарий после визита, ответ владельца.

SET search_path TO bookings, public;

CREATE TABLE IF NOT EXISTS reviews (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id  UUID        NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  company_id  UUID        NOT NULL,
  client_id   UUID,
  client_name TEXT,
  master_id   UUID,
  master_name TEXT,
  rating      SMALLINT    NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     TEXT        CHECK (char_length(comment) <= 2000),
  reply       TEXT        CHECK (char_length(reply) <= 1000),
  replied_at  TIMESTAMPTZ,
  is_public   BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reviews_company
  ON reviews (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reviews_master
  ON reviews (master_id, created_at DESC);
