-- 030_finance_source_and_delta.sql
-- (1) Идемпотентность внешних операций: source_type/source_id + уникальный индекс.
--     Нужно, чтобы повтор/ретрай выплаты ЗП не создавал вторую расходную операцию.
-- (2) Знаковый balance_delta: реверс при удалении операции раньше вычислял знак из
--     kind и всегда положительного amount, из-за чего удаление «корректировки вниз»
--     портило баланс. Теперь храним фактически применённую (знаковую) дельту.

SET search_path TO finance;

ALTER TABLE operations
  ADD COLUMN IF NOT EXISTS source_type   TEXT,
  ADD COLUMN IF NOT EXISTS source_id     UUID,
  ADD COLUMN IF NOT EXISTS balance_delta NUMERIC(14, 2);

-- Бэкфилл знаковой дельты для существующих строк.
-- Для adjust знак восстановить нельзя (amount уже по модулю) — оставляем NULL,
-- реверс таких legacy-строк идёт по старой (kind-based) ветке.
UPDATE operations
   SET balance_delta = CASE
     WHEN kind IN ('income', 'transfer_in')  THEN amount
     WHEN kind IN ('expense', 'transfer_out') THEN -amount
     ELSE balance_delta
   END
 WHERE balance_delta IS NULL AND kind <> 'adjust';

CREATE UNIQUE INDEX IF NOT EXISTS uq_ops_source
  ON operations(company_id, source_type, source_id)
  WHERE source_type IS NOT NULL AND source_id IS NOT NULL AND is_deleted = FALSE;
