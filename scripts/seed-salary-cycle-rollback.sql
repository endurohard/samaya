-- seed-salary-cycle-rollback.sql — удаляет всё из seed-salary-cycle.sql.
-- Метка [DEMO-SALARY] отделяет демо от боевых данных.

\set ON_ERROR_STOP on

BEGIN;

DELETE FROM bookings.bookings WHERE notes = '[DEMO-SALARY]';
DELETE FROM salary.service_commissions WHERE notes = '[DEMO-SALARY]';
DELETE FROM salary.schemes WHERE notes = '[DEMO-SALARY]';
-- Члены группы уйдут каскадом вместе с группой.
DELETE FROM salary.staff_groups WHERE name = 'Демо: Менеджеры';
DELETE FROM salons.masters WHERE notes = '[DEMO-SALARY]';
DELETE FROM clients.clients WHERE full_name = 'Демо Зарплата-Клиент';

COMMIT;

SELECT 'осталось демо-зарплатных объектов' AS что,
       (SELECT COUNT(*) FROM salons.masters WHERE notes = '[DEMO-SALARY]')
     + (SELECT COUNT(*) FROM bookings.bookings WHERE notes = '[DEMO-SALARY]') AS сколько;
