-- 037_default_finance_accounts.sql
--
-- Счета «Наличные» и «Безналичные» для существующих компаний.
--
-- Без них не работает половина денежного контура: в пополнении лицевого счёта
-- выпадающий список счетов пуст, выбрать нал/безнал нечем, а операции
-- записываются без finance_op_id — то есть деньги не попадают в кассу и не
-- видны в разделе «Финансы».

SET search_path TO finance, public;

INSERT INTO accounts (company_id, name, type)
SELECT c.company_id, 'Наличные', 'cash'
  FROM (SELECT DISTINCT company_id FROM salons.company_profile) c
 WHERE NOT EXISTS (
   SELECT 1 FROM accounts a WHERE a.company_id = c.company_id AND a.type = 'cash'
 );

INSERT INTO accounts (company_id, name, type)
SELECT c.company_id, 'Безналичные', 'bank'
  FROM (SELECT DISTINCT company_id FROM salons.company_profile) c
 WHERE NOT EXISTS (
   SELECT 1 FROM accounts a WHERE a.company_id = c.company_id AND a.type = 'bank'
 );
