-- seed-salary-cycle.sql — полный цикл зарплаты на демо-данных.
--
-- Сценарий владельца: группа из 3 менеджеров получает 2% с категории
-- «Аппаратные процедуры» (на группу, делится поровну), врач — 30% со своей
-- выручки после скидки. Создаёт сотрудников, группу, правило, схему и три
-- завершённые продажи текущего месяца, чтобы расчёт показал реальные цифры.
--
-- Ожидаемые числа (проверяются после прогона):
--   услуги категории: 50 000 + 30 000 (скидка 3 000 → 27 000) + 20 000 = 97 000
--   пул группы: 2% × 97 000 = 1 940 → доли 647 / 647 / 646
--   врач: 30% × 97 000 = 29 100
--
-- Запуск:  docker exec -i samaya-postgres psql -U samaya -d samaya < scripts/seed-salary-cycle.sql
-- Откат:   docker exec -i samaya-postgres psql -U samaya -d samaya < scripts/seed-salary-cycle-rollback.sql

\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  v_company  UUID := '00000000-0000-0000-0000-000000000001';
  v_cat      UUID;
  v_doc      UUID;
  v_grp      UUID;
  v_client   UUID;
  v_svc      RECORD;
  v_booking  UUID;
  v_m1 UUID; v_m2 UUID; v_m3 UUID;
  v_month_start DATE := date_trunc('month', NOW())::date;
  v_prices  NUMERIC[] := ARRAY[50000, 30000, 20000];
  v_disc    NUMERIC[] := ARRAY[0, 3000, 0];
  i INT;
BEGIN
  SELECT id INTO v_cat FROM salons.service_categories
   WHERE company_id = v_company AND name ILIKE '%аппарат%' LIMIT 1;
  IF v_cat IS NULL THEN RAISE EXCEPTION 'Нет категории «Аппаратные процедуры»'; END IF;

  -- Врач-исполнитель (свой, чтобы не искажать зарплату реальных сотрудников)
  INSERT INTO salons.masters (company_id, display_name, first_name, last_name,
                              position, category, provides_services, is_active, notes)
  VALUES (v_company, 'Демо-Врач Дина', 'Дина', 'Демо-Врач',
          'Врач-косметолог', 'Врач', TRUE, TRUE, '[DEMO-SALARY]')
  RETURNING id INTO v_doc;

  -- Три менеджера (услуг не оказывают)
  INSERT INTO salons.masters (company_id, display_name, first_name, last_name,
                              position, category, provides_services, is_active, notes)
  VALUES (v_company, 'Демо-Менеджер Анна', 'Анна', 'Демо-Менеджер',
          'Менеджер по продажам', 'Менеджер по продажам', FALSE, TRUE, '[DEMO-SALARY]')
  RETURNING id INTO v_m1;
  INSERT INTO salons.masters (company_id, display_name, first_name, last_name,
                              position, category, provides_services, is_active, notes)
  VALUES (v_company, 'Демо-Менеджер Белла', 'Белла', 'Демо-Менеджер',
          'Менеджер по продажам', 'Менеджер по продажам', FALSE, TRUE, '[DEMO-SALARY]')
  RETURNING id INTO v_m2;
  INSERT INTO salons.masters (company_id, display_name, first_name, last_name,
                              position, category, provides_services, is_active, notes)
  VALUES (v_company, 'Демо-Менеджер Вера', 'Вера', 'Демо-Менеджер',
          'Менеджер по продажам', 'Менеджер по продажам', FALSE, TRUE, '[DEMO-SALARY]')
  RETURNING id INTO v_m3;

  -- Группа и состав
  INSERT INTO salary.staff_groups (company_id, name)
  VALUES (v_company, 'Демо: Менеджеры') RETURNING id INTO v_grp;
  INSERT INTO salary.staff_group_members (group_id, master_id)
  VALUES (v_grp, v_m1), (v_grp, v_m2), (v_grp, v_m3);

  -- Правило: 2% с категории «Аппаратные процедуры» → группе
  INSERT INTO salary.service_commissions
    (company_id, category_id, staff_group_id, commission_type, amount, effective_from, notes)
  VALUES (v_company, v_cat, v_grp, 'percent', 2, v_month_start, '[DEMO-SALARY]');

  -- Схема врача: 30% с услуг
  INSERT INTO salary.schemes
    (company_id, master_id, scheme_type, percent_services, effective_from, notes)
  VALUES (v_company, v_doc, 'percent_only', 30, v_month_start, '[DEMO-SALARY]');

  -- Клиент
  INSERT INTO clients.clients (company_id, phone, full_name, source)
  VALUES (v_company, '+79280000201', 'Демо Зарплата-Клиент', 'admin')
  ON CONFLICT DO NOTHING;
  SELECT id INTO v_client FROM clients.clients
   WHERE company_id = v_company AND phone::text = '+79280000201';

  -- Три завершённые продажи текущего месяца услугами из категории
  FOR i IN 1..3 LOOP
    SELECT s.id, s.name, COALESCE(s.duration_minutes, 60) AS dur INTO v_svc
      FROM salons.services s
     WHERE s.company_id = v_company AND s.category_id = v_cat AND s.is_active = TRUE
     ORDER BY s.name LIMIT 1 OFFSET (i - 1);
    IF v_svc.id IS NULL THEN RAISE EXCEPTION 'В категории меньше 3 услуг'; END IF;

    INSERT INTO bookings.bookings
      (company_id, master_id, client_id, client_phone, client_name,
       starts_at, ends_at, status, total_price, discount_pct, discount_amount,
       source, notes, completed_at, paid_at, payment_method)
    VALUES
      (v_company, v_doc, v_client, '+79280000201', 'Демо Зарплата-Клиент',
       v_month_start + (i || ' days')::interval + INTERVAL '11 hours',
       v_month_start + (i || ' days')::interval + INTERVAL '12 hours',
       'completed', v_prices[i],
       CASE WHEN v_disc[i] > 0 THEN 10 ELSE 0 END, v_disc[i],
       'admin', '[DEMO-SALARY]',
       v_month_start + (i || ' days')::interval + INTERVAL '12 hours',
       v_month_start + (i || ' days')::interval + INTERVAL '12 hours',
       'cash')
    RETURNING id INTO v_booking;

    INSERT INTO bookings.booking_services
      (booking_id, service_id, service_name, price, duration_minutes)
    VALUES (v_booking, v_svc.id, v_svc.name, v_prices[i], v_svc.dur);
  END LOOP;

  RAISE NOTICE 'Демо-цикл зарплаты создан: врач %, группа %', v_doc, v_grp;
END $$;

COMMIT;

SELECT 'сотрудников' AS что, COUNT(*)::text AS сколько FROM salons.masters WHERE notes = '[DEMO-SALARY]'
UNION ALL SELECT 'записей', COUNT(*)::text FROM bookings.bookings WHERE notes = '[DEMO-SALARY]'
UNION ALL SELECT 'выручка после скидки',
  TO_CHAR(SUM(total_price - discount_amount), 'FM999999999') FROM bookings.bookings WHERE notes = '[DEMO-SALARY]';
