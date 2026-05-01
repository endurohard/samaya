-- 017_gift_certificates.sql
-- Подарочные сертификаты: продажа, хранение баланса, списание при оплате.

SET search_path TO finance, public;

CREATE TABLE IF NOT EXISTS gift_certificates (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  UUID        NOT NULL,
  code        TEXT        NOT NULL,
  amount      NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  balance     NUMERIC(10,2) NOT NULL CHECK (balance >= 0),
  client_id   UUID,
  client_name TEXT,
  sold_by     UUID,
  sold_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  DATE,
  status      TEXT        NOT NULL DEFAULT 'active'
              CHECK (status IN ('active', 'used', 'expired', 'cancelled')),
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_cert_code UNIQUE (company_id, code)
);

CREATE INDEX IF NOT EXISTS idx_cert_company
  ON gift_certificates (company_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS cert_usages (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  certificate_id  UUID        NOT NULL REFERENCES gift_certificates(id) ON DELETE CASCADE,
  booking_id      UUID,
  amount_used     NUMERIC(10,2) NOT NULL CHECK (amount_used > 0),
  used_by         UUID,
  used_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes           TEXT
);

CREATE INDEX IF NOT EXISTS idx_cert_usages_cert
  ON cert_usages (certificate_id, used_at DESC);
