-- 011_sales_payment.sql
-- Добавляем поля оплаты к записи: способ оплаты и скидка.
-- «Продажа» в MVP — это завершённая (completed) запись с указанным payment_method.

SET search_path TO bookings, public;

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS payment_method TEXT
      CHECK (payment_method IN ('cash', 'card', 'online')),
  ADD COLUMN IF NOT EXISTS discount_pct    NUMERIC(5,2)  NOT NULL DEFAULT 0
      CHECK (discount_pct >= 0 AND discount_pct <= 100),
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

-- Индекс для выборки «всех продаж компании за период»
CREATE INDEX IF NOT EXISTS idx_bookings_completed
  ON bookings(company_id, completed_at)
  WHERE status = 'completed';
