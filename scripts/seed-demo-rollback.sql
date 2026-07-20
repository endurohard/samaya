-- seed-demo-rollback.sql — удаляет всё, что создал seed-demo.sql.
--
-- Демо-данные помечены notes '[DEMO]%' и именами 'Демо %', поэтому боевые
-- записи не затрагиваются. Услуги записей уходят каскадом по FK.

\set ON_ERROR_STOP on

BEGIN;

DELETE FROM bookings.bookings WHERE notes LIKE '[DEMO]%';
DELETE FROM clients.clients   WHERE full_name LIKE 'Демо %';

COMMIT;

SELECT 'осталось демо-записей' AS что, COUNT(*)::text AS сколько
  FROM bookings.bookings WHERE notes LIKE '[DEMO]%'
UNION ALL
SELECT 'осталось демо-клиентов', COUNT(*)::text
  FROM clients.clients WHERE full_name LIKE 'Демо %';
