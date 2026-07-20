-- seed-demo.sql — демонстрационные данные для проверки расчётов.
--
-- Наполняет систему так, чтобы стали видны вещи, которые на пустой базе
-- проверить нельзя: возвращаемость клиентов по группам услуг, зарплата со
-- скидками, комиссии группе сотрудников, занятое время.
--
-- Запуск:  docker exec -i samaya-postgres psql -U samaya -d samaya < scripts/seed-demo.sql
-- Откат:   docker exec -i samaya-postgres psql -U samaya -d samaya < scripts/seed-demo-rollback.sql
--
-- Все демо-записи помечены source='demo_seed' и notes с меткой [DEMO],
-- чтобы их можно было удалить одной командой и не спутать с боевыми.

\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  v_company  UUID := '00000000-0000-0000-0000-000000000001';
  v_master   UUID;
  v_cat_laser UUID;
  v_svc      RECORD;
  v_client   UUID;
  v_booking  UUID;
  v_phone    TEXT;
  v_name     TEXT;
  v_day      INT;
  v_visit    INT;
  v_price    NUMERIC;
  v_disc     NUMERIC;
  v_start    TIMESTAMPTZ;
  v_dur      INT;
  -- Клиенты: имя, телефон, сколько визитов сделать. Разное число визитов —
  -- чтобы возвращаемость по группам услуг не была вырожденной (0% или 100%).
  v_clients  TEXT[][] := ARRAY[
    ARRAY['Демо Айгуль',   '+79280000101', '4'],
    ARRAY['Демо Патимат',  '+79280000102', '3'],
    ARRAY['Демо Зарема',   '+79280000103', '2'],
    ARRAY['Демо Мадина',   '+79280000104', '1'],
    ARRAY['Демо Сакинат',  '+79280000105', '1'],
    ARRAY['Демо Хадижат',  '+79280000106', '5']
  ];
BEGIN
  SELECT id INTO v_master FROM salons.masters
   WHERE company_id = v_company AND is_active = TRUE
   ORDER BY created_at LIMIT 1;
  IF v_master IS NULL THEN
    RAISE EXCEPTION 'Нет активных сотрудников — сначала заведите мастера';
  END IF;

  SELECT id INTO v_cat_laser FROM salons.service_categories
   WHERE company_id = v_company AND name ILIKE '%лазерн%' LIMIT 1;

  FOR i IN 1 .. array_length(v_clients, 1) LOOP
    v_name  := v_clients[i][1];
    v_phone := v_clients[i][2];

    INSERT INTO clients.clients (company_id, phone, full_name, source)
    VALUES (v_company, v_phone::text, v_name, 'admin')
    ON CONFLICT DO NOTHING;

    SELECT id INTO v_client FROM clients.clients
     WHERE company_id = v_company AND phone::text = v_phone;

    -- Визиты назад во времени: последний недавно, первый — несколько месяцев
    -- назад. Так у возвращаемости появляется интервал между визитами.
    FOR v_visit IN 1 .. v_clients[i][3]::int LOOP
      v_day := v_visit * 24 + i;  -- разводим клиентов по дням

      -- Услуга: для чётных клиентов — из «лазерной» категории, чтобы разрез
      -- по группам услуг показал разную возвращаемость.
      SELECT s.id, s.name, s.price, s.duration_minutes INTO v_svc
        FROM salons.services s
       WHERE s.company_id = v_company AND s.is_active = TRUE
         AND (v_cat_laser IS NULL
              OR (i % 2 = 0 AND s.category_id = v_cat_laser)
              OR (i % 2 = 1 AND s.category_id IS DISTINCT FROM v_cat_laser))
       ORDER BY s.name
       LIMIT 1 OFFSET (i % 3);
      CONTINUE WHEN v_svc.id IS NULL;

      v_price := v_svc.price;
      v_dur   := COALESCE(v_svc.duration_minutes, 60);
      -- Скидка у каждого третьего визита — без неё не проверить, что процент
      -- мастера считается с суммы после скидки.
      v_disc  := CASE WHEN v_visit % 3 = 0 THEN ROUND(v_price * 0.15, 2) ELSE 0 END;

      v_start := date_trunc('day', NOW() - (v_day || ' days')::interval)
                 + INTERVAL '10 hours' + ((i * 40) || ' minutes')::interval;

      INSERT INTO bookings.bookings
        (company_id, master_id, client_id, client_phone, client_name,
         starts_at, ends_at, status, total_price, discount_pct, discount_amount,
         source, notes, completed_at, paid_at, payment_method)
      VALUES
        (v_company, v_master, v_client, v_phone::text, v_name,
         v_start, v_start + (v_dur || ' minutes')::interval,
         'completed', v_price,
         CASE WHEN v_disc > 0 THEN 15 ELSE 0 END, v_disc,
         'admin', '[DEMO] демо-данные для проверки отчётов',
         v_start + (v_dur || ' minutes')::interval,
         v_start + (v_dur || ' minutes')::interval,
         CASE WHEN v_visit % 2 = 0 THEN 'card' ELSE 'cash' END)
      RETURNING id INTO v_booking;

      INSERT INTO bookings.booking_services
        (booking_id, service_id, service_name, price, duration_minutes)
      VALUES (v_booking, v_svc.id, v_svc.name, v_price, v_dur);
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Демо-данные добавлены: % клиентов', array_length(v_clients, 1);
END $$;

COMMIT;

-- Итог: что получилось
SELECT 'клиентов'   AS что, COUNT(*)::text AS сколько FROM clients.clients WHERE full_name LIKE 'Демо %'
UNION ALL
SELECT 'записей',   COUNT(*)::text FROM bookings.bookings WHERE notes LIKE '[DEMO]%'
UNION ALL
SELECT 'выручка',   TO_CHAR(SUM(total_price - discount_amount), 'FM999999999') FROM bookings.bookings WHERE notes LIKE '[DEMO]%'
UNION ALL
SELECT 'скидок',    TO_CHAR(SUM(discount_amount), 'FM999999999') FROM bookings.bookings WHERE notes LIKE '[DEMO]%';
