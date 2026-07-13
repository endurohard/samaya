-- 029_movements_idempotency_null_lot.sql
-- Идемпотентность движений при lot_id IS NULL (виртуальное движение
-- stock_insufficient). Прежний уникальный индекс использовал lot_id напрямую,
-- поэтому NULL-ы считались различными и повтор события плодил дубли виртуальных
-- расходов. Переводим ключ на COALESCE(lot_id, нулевой uuid).

SET search_path TO inventory;

DROP INDEX IF EXISTS idx_movements_idempotency;

CREATE UNIQUE INDEX IF NOT EXISTS idx_movements_idempotency
  ON stock_movements(
    company_id, source_type, source_id, product_id,
    COALESCE(lot_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE source_type IS NOT NULL AND source_id IS NOT NULL;
