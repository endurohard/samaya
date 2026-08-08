-- 047_booking_service_manager.sql
--
-- Менеджер на позицию записи.
--
-- До сих пор менеджер был один на всю запись (bookings.manager_id), и вся
-- комиссия уходила ему. На липосакции так не работает: в одну запись
-- попадают две-три процедуры, и каждую привёл свой менеджер — комиссию надо
-- делить по позициям, а не отдавать целиком оформившему запись.
--
-- NULL означает «как у записи»: старые записи и обычные услуги, где делить
-- нечего, продолжают считаться по bookings.manager_id без миграции данных.
--
-- ON DELETE SET NULL, а не CASCADE: увольнение сотрудника не должно уносить
-- позицию записи вместе с её ценой — история продаж важнее ссылки.

ALTER TABLE bookings.booking_services
  ADD COLUMN IF NOT EXISTS manager_id UUID
    REFERENCES salons.masters(id) ON DELETE SET NULL;

-- Зарплатный расчёт ходит по менеджеру за период; без индекса это seq scan
-- по всем позициям всех записей компании.
CREATE INDEX IF NOT EXISTS idx_booking_services_manager
  ON bookings.booking_services (manager_id)
  WHERE manager_id IS NOT NULL;

COMMENT ON COLUMN bookings.booking_services.manager_id IS
  'Менеджер, оформивший эту позицию. NULL — берётся bookings.manager_id.';

-- Снимаем индекс из 008: он разрешает ровно ОДНО авто-начисление на запись
-- (UNIQUE по source_booking_id), а начислений по записи давно несколько —
-- исполнителю и менеджеру. С INSERT ... ON CONFLICT DO NOTHING вторая строка
-- молча пропадала: доля менеджера просто не начислялась. Пока комиссии никто
-- не настраивал, это не проявлялось; с менеджером на позицию строк станет ещё
-- больше (по одной на каждого оформившего).
--
-- Идемпотентность обеспечивает uq_accruals_booking_source из 046 —
-- UNIQUE (company_id, master_id, source_booking_id, source): повторная
-- обработка той же записи по-прежнему не задваивает деньги.
DROP INDEX IF EXISTS salary.uq_accr_auto_booking;
