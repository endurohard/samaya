-- 046_instant_accruals.sql
--
-- Мгновенные начисления по оплаченной записи.
--
-- Модель: часть зарплаты привязана к конкретной записи и известна сразу
-- после оплаты — доля исполнителя (% услуг и персональные ставки) и доля
-- менеджера, оформившего запись (фиксированная комиссия и % от созданных
-- записей). Их начисляем сразу. Остальное — доля из процентного пула,
-- ставка за смены, % от выручки компании и гарантированная сумма — зависит
-- от периода целиком и считается в конце месяца или по команде расчёта.
--
-- booking_accrued — маркер «эта запись уже обработана». Нужен именно
-- отдельной таблицей, а не «есть ли строки в accruals»: запись может
-- законно не дать ни одного начисления (у мастера нет схемы), и без
-- маркера воркер брал бы её в работу бесконечно.

SET search_path TO salary, public;

CREATE TABLE IF NOT EXISTS booking_accrued (
  company_id    UUID        NOT NULL,
  booking_id    UUID        PRIMARY KEY,
  accrued_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  processed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_booking_accrued_company
  ON booking_accrued(company_id, processed_at DESC);

-- Идемпотентность: одна строка начисления на (сотрудник, запись, вид).
-- Повторная обработка той же записи не задваивает деньги.
CREATE UNIQUE INDEX IF NOT EXISTS uq_accruals_booking_source
  ON accruals(company_id, master_id, source_booking_id, source)
  WHERE source_booking_id IS NOT NULL;

-- Выборка «сколько уже начислено мгновенно за период» в расчёте ЗП.
CREATE INDEX IF NOT EXISTS idx_accruals_source_booking
  ON accruals(company_id, source_booking_id)
  WHERE source_booking_id IS NOT NULL;
