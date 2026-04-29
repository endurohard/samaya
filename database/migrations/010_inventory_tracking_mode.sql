-- 010_inventory_tracking_mode.sql
-- Расширяет inventory.products для расходников с разными режимами учёта:
-- - auto: списание по техкарте (фиксированная норма на услугу) — текущее поведение
-- - manual: ручное списание мастером в конце смены (расходники без нормы)
-- - periodic: списание только при инвентаризации (разница факт/учёт)
-- - expense_only: вообще не на складе (закупки сразу в Финансы как расход)

SET search_path TO inventory, public;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS tracking_mode TEXT NOT NULL DEFAULT 'auto'
    CHECK (tracking_mode IN ('auto', 'manual', 'periodic', 'expense_only'));

CREATE INDEX IF NOT EXISTS idx_products_tracking_mode
  ON products(company_id, tracking_mode) WHERE is_active = TRUE;
