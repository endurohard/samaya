-- 012_promotions.sql
-- Промокоды / акции. Хранятся рядом с записями, т.к. применяются при оплате.

SET search_path TO bookings, public;

CREATE TABLE IF NOT EXISTS promotions (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID        NOT NULL,
  code         TEXT        NOT NULL,
  name         TEXT        NOT NULL,
  discount_pct NUMERIC(5,2) NOT NULL CHECK (discount_pct > 0 AND discount_pct <= 100),
  valid_from   DATE,
  valid_to     DATE,
  max_uses     INT         CHECK (max_uses IS NULL OR max_uses > 0),
  used_count   INT         NOT NULL DEFAULT 0,
  is_active    BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, code)
);

CREATE INDEX IF NOT EXISTS idx_promotions_company ON promotions(company_id, is_active);

-- Ссылка на использованный промокод в записи
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS promo_id UUID REFERENCES promotions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS promo_code TEXT;
