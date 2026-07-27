-- 042_promo_coupons.sql
--
-- Акции-купоны (запрос владельца: «купон на 1000 ₽ на список услуг,
-- индивидуальная ссылка, мониторинг набора аудитории»):
--   1) promotions.discount_amount — скидка суммой в ₽ (альтернатива %);
--      теперь у акции ровно один тип скидки: discount_pct ИЛИ discount_amount.
--   2) promotion_services — на какие услуги распространяется акция
--      (пусто = на любые услуги).
--   3) promo_coupons — индивидуальные купоны-ссылки: token в URL,
--      воронка статусов issued → opened → claimed → used и контакты
--      клиента, оставленные на лендинге.

SET search_path TO bookings, public;

ALTER TABLE promotions
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12,2)
    CHECK (discount_amount IS NULL OR discount_amount > 0);

-- Ровно один тип скидки. Существующие строки все с discount_pct — валидны.
ALTER TABLE promotions ALTER COLUMN discount_pct DROP NOT NULL;
ALTER TABLE promotions DROP CONSTRAINT IF EXISTS promotions_discount_type_check;
ALTER TABLE promotions ADD CONSTRAINT promotions_discount_type_check
  CHECK ((discount_pct IS NOT NULL)::int + (discount_amount IS NOT NULL)::int = 1);

CREATE TABLE IF NOT EXISTS promotion_services (
  promo_id    UUID NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  service_id  UUID NOT NULL,   -- salons.services(id), без FK (schema-per-service)
  PRIMARY KEY (promo_id, service_id)
);

CREATE TABLE IF NOT EXISTS promo_coupons (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID        NOT NULL,
  promo_id    UUID        NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  token       TEXT        NOT NULL UNIQUE,     -- часть индивидуальной ссылки /promo/<token>
  label       TEXT,                            -- пометка «кому выдан» (канал, имя)
  status      TEXT        NOT NULL DEFAULT 'issued'
                CHECK (status IN ('issued', 'opened', 'claimed', 'used')),
  opened_at   TIMESTAMPTZ,                     -- первое открытие ссылки
  claimed_at  TIMESTAMPTZ,                     -- клиент оставил контакты
  used_at     TIMESTAMPTZ,                     -- купон погашен
  client_name  TEXT,
  client_phone TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_promo_coupons_promo ON promo_coupons(promo_id, status);
CREATE INDEX IF NOT EXISTS idx_promo_coupons_company ON promo_coupons(company_id, created_at DESC);
