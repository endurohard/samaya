-- 01-test-data.sql
-- Тестовые данные для демо. Идемпотентен: можно прогонять многократно.
-- Чистит старые seed-записи (отмеченные '[seed]' в notes/comment) и вставляет свежие.
-- НЕ трогает реальные данные пользователя.

\set companyId '00000000-0000-0000-0000-000000000001'
\set ownerId   '32848548-073e-4953-8261-0247bc9e57b4'

-- ============================================================
-- 1. SERVICES — добавим разнообразия (по 2-3 услуги в каждую категорию)
-- ============================================================
WITH cat AS (
  SELECT id, name FROM salons.service_categories WHERE company_id = :'companyId'
)
INSERT INTO salons.services (company_id, name, price, duration_minutes, category_id, color, is_active)
SELECT :'companyId', s.name, s.price, s.duration, c.id, s.color, TRUE
FROM (VALUES
  ('Биоревитализация',          15000, 60,  'Косметология',     '#a78bfa'),
  ('Контурная пластика губ',    25000, 75,  'Косметология',     '#f472b6'),
  ('Мезотерапия лица',          12000, 90,  'Косметология',     '#c084fc'),
  ('ЛЭ зоны бикини',            7000,  45,  'Лазерная эпиляция','#fb7185'),
  ('ЛЭ подмышек',               4000,  30,  'Лазерная эпиляция','#fb923c'),
  ('Антицеллюлитный массаж',    8000,  60,  'Массаж',           '#fbbf24'),
  ('Расслабляющий массаж',      6000,  60,  'Массаж',           '#a3e635'),
  ('Лимфодренажный массаж',     7500,  75,  'Массаж',           '#34d399'),
  ('Пилинг кислотный',          9000,  60,  'Уход за лицом',    '#22d3ee'),
  ('Карбокситерапия',           11000, 45,  'Уход за лицом',    '#60a5fa'),
  ('Ультразвуковая чистка',     6500,  60,  'Уход за лицом',    '#818cf8'),
  ('SPA-уход для рук',          3500,  45,  'Косметология',     '#f87171'),
  ('Маникюр + покрытие',        4500,  90,  'Косметология',     '#facc15')
) AS s(name, price, duration, category_name, color)
JOIN cat c ON c.name = s.category_name
WHERE NOT EXISTS (
  SELECT 1 FROM salons.services x
  WHERE x.company_id = :'companyId' AND x.name = s.name
);

-- ============================================================
-- 2. CLIENTS — 30 тестовых клиентов с разными сегментами
-- ============================================================
DELETE FROM clients.clients
WHERE company_id = :'companyId' AND comment LIKE '[seed]%';

INSERT INTO clients.clients (company_id, phone, full_name, birthday, gender, email, comment, source, avatar_color, bonus_balance)
SELECT :'companyId', c.phone, c.name, c.bday::date, c.gender, c.email, '[seed] ' || c.note, 'admin', c.color, c.bonus
FROM (VALUES
  ('+79010000001', 'Алиева Зарема',     '1990-03-15'::date, 'female', 'zarema.a@example.com',  'постоянный клиент',         '#fb7185',  500),
  ('+79010000002', 'Гасанова Мадина',   '1985-07-22'::date, 'female', 'm.gasanova@gmail.com',   'предпочитает утренние часы', '#a78bfa', 1200),
  ('+79010000003', 'Магомедова Айша',   '1995-11-08'::date, 'female', null,                     'аллергия на мёд',           '#fb923c',  300),
  ('+79010000004', 'Алиев Рамазан',     '1988-04-30'::date, 'male',   'r.aliev@example.com',    'муж клиентки Гасановой',    '#60a5fa',    0),
  ('+79010000005', 'Курбанова Патимат', '1992-09-12'::date, 'female', null,                     '',                          '#f472b6',  800),
  ('+79010000006', 'Дибирова Зара',     '1987-12-01'::date, 'female', 'zara.d@example.com',     'свадьба в июне',            '#c084fc', 2500),
  ('+79010000007', 'Османова Лейла',    '1993-06-18'::date, 'female', null,                     '',                          '#34d399',    0),
  ('+79010000008', 'Шахмандарова Хава', '1996-02-25'::date, 'female', null,                     'студентка, скидка 10%',     '#facc15',  150),
  ('+79010000009', 'Меджидова Алина',   '1991-08-14'::date, 'female', 'alina.m@gmail.com',      '',                          '#22d3ee',  600),
  ('+79010000010', 'Раджабова Фатима',  '1989-05-03'::date, 'female', null,                     '',                          '#a3e635',    0),
  ('+79010000011', 'Юсупова Заира',     '1994-10-07'::date, 'female', 'zaira.y@example.com',    '',                          '#fb7185',  400),
  ('+79010000012', 'Магомедов Ахмед',   '1980-01-19'::date, 'male',   null,                     'муж администратора',        '#60a5fa', 1000),
  ('+79010000013', 'Сулейманова Аминат','1986-11-23'::date, 'female', null,                     'спящий — последний 6 мес',  '#fb923c',    0),
  ('+79010000014', 'Гаджиева Эльмира',  '1990-04-11'::date, 'female', 'elmira.g@example.com',   '',                          '#a78bfa',  900),
  ('+79010000015', 'Багомедова Сабина', '1997-07-30'::date, 'female', null,                     'новый клиент, апрель',      '#f472b6',    0),
  ('+79010000016', 'Алиханова Зарина',  '1984-03-08'::date, 'female', null,                     '',                          '#c084fc',  300),
  ('+79010000017', 'Ибрагимова Динара', '1988-09-25'::date, 'female', 'dinara.i@gmail.com',     '',                          '#34d399',  700),
  ('+79010000018', 'Шамсудинова Раиса', '1993-12-17'::date, 'female', null,                     '',                          '#facc15',    0),
  ('+79010000019', 'Магомедова Карина', '1995-05-29'::date, 'female', null,                     'новый клиент, март',        '#22d3ee',  100),
  ('+79010000020', 'Абдулаева Ясмина',  '1991-02-14'::date, 'female', 'yasmina.a@example.com',  '',                          '#a3e635', 1500),
  ('+79010000021', 'Рамазанова Альбина','1989-08-20'::date, 'female', null,                     '',                          '#fb7185',  450),
  ('+79010000022', 'Хадиева Загра',     '1996-06-05'::date, 'female', null,                     'студентка',                 '#fb923c',  200),
  ('+79010000023', 'Магомедова Зайнаб', '1987-10-12'::date, 'female', 'z.magomedova@example.com','постоянный, 5+ лет',        '#a78bfa', 3500),
  ('+79010000024', 'Айдамирова Лариса', '1992-01-28'::date, 'female', null,                     '',                          '#60a5fa',  800),
  ('+79010000025', 'Курбанов Магомед',  '1985-04-09'::date, 'male',   null,                     '',                          '#f472b6',    0),
  ('+79010000026', 'Гереева Ангелина',  '1994-09-16'::date, 'female', 'angelina.g@gmail.com',   '',                          '#c084fc',  600),
  ('+79010000027', 'Магомедова Самира', '1990-11-04'::date, 'female', null,                     'аллергия на лидокаин',      '#34d399', 1100),
  ('+79010000028', 'Османова Эльза',    '1986-05-22'::date, 'female', null,                     '',                          '#facc15',  250),
  ('+79010000029', 'Меджидов Тимур',    '1983-07-13'::date, 'male',   't.medjidov@example.com', 'муж клиентки Меджидовой',   '#22d3ee',  300),
  ('+79010000030', 'Гаджиева Радима',   '1998-03-26'::date, 'female', null,                     'самый молодой клиент',      '#a3e635',    0)
) AS c(phone, name, bday, gender, email, note, color, bonus);

-- ============================================================
-- 3. MASTER SCHEDULES — рабочие часы 10:00-20:00 для всех мастеров на ±30 дней
-- ============================================================
INSERT INTO salons.master_schedules (company_id, master_id, work_date, start_time, end_time, is_day_off)
SELECT :'companyId', m.id, d::date,
       CASE WHEN extract(dow FROM d) = 0 THEN NULL ELSE '10:00'::time END,
       CASE WHEN extract(dow FROM d) = 0 THEN NULL ELSE '20:00'::time END,
       extract(dow FROM d) = 0  -- воскресенье = выходной
FROM salons.masters m
CROSS JOIN generate_series((CURRENT_DATE - 30)::date, (CURRENT_DATE + 30)::date, INTERVAL '1 day') d
WHERE m.company_id = :'companyId' AND m.is_active = TRUE
ON CONFLICT (master_id, work_date) DO NOTHING;

-- ============================================================
-- 4. BOOKINGS — чистим старые seed + вставляем свежие
-- 60 записей: 40 в прошлом (completed), 20 в будущем (confirmed/pending)
-- Каждый мастер получает 1-2 записи в день, не пересекающиеся по времени
-- ============================================================
DELETE FROM bookings.booking_services
WHERE booking_id IN (
  SELECT id FROM bookings.bookings
  WHERE company_id = :'companyId' AND notes LIKE '[seed]%'
);
DELETE FROM bookings.bookings
WHERE company_id = :'companyId' AND notes LIKE '[seed]%';

-- Past completed: 40 bookings распределены за последние 30 дней, по 1-2 в день на мастера
WITH days AS (
  SELECT generate_series(CURRENT_DATE - 30, CURRENT_DATE - 1, INTERVAL '1 day')::date AS d
),
masters AS (
  SELECT id, ROW_NUMBER() OVER () AS mn FROM salons.masters
  WHERE company_id = :'companyId' AND is_active = TRUE
),
clients_seq AS (
  SELECT id, phone, full_name, ROW_NUMBER() OVER () AS cn
  FROM clients.clients
  WHERE company_id = :'companyId' AND comment LIKE '[seed]%'
),
services_pick AS (
  SELECT id, name, price, duration_minutes, ROW_NUMBER() OVER () AS sn
  FROM salons.services WHERE company_id = :'companyId' AND is_active = TRUE
),
slots AS (
  -- На каждый день генерируем 4 записи (одна на каждого мастера) в разное время
  SELECT
    d.d AS work_date,
    m.id AS master_id,
    -- Время старта: 10:00 + (master_index * 2.5 часа) → 10:00, 12:30, 15:00, 17:30
    ('10:00'::time + (m.mn - 1) * INTERVAL '2 hours 30 minutes')::time AS start_time,
    -- Сдвиг недетерминированный, чтобы разнообразить services/clients
    ((extract(epoch FROM d.d)::bigint / 86400 + m.mn) % 18 + 1)::int AS svc_idx,
    ((extract(epoch FROM d.d)::bigint / 86400 * 4 + m.mn) % 30 + 1)::int AS cli_idx
  FROM days d CROSS JOIN masters m
)
INSERT INTO bookings.bookings
  (company_id, master_id, client_id, client_phone, client_name,
   starts_at, ends_at, status, total_price, source, notes, completed_at)
SELECT
  :'companyId',
  s.master_id,
  c.id,
  c.phone,
  c.full_name,
  (s.work_date::text || 'T' || s.start_time::text || '+03:00')::timestamptz,
  (s.work_date::text || 'T' || s.start_time::text || '+03:00')::timestamptz + (sv.duration_minutes::text || ' minutes')::interval,
  'completed',
  sv.price,
  'admin',
  '[seed] auto',
  ((s.work_date::text || 'T' || s.start_time::text || '+03:00')::timestamptz + (sv.duration_minutes::text || ' minutes')::interval) + INTERVAL '5 minutes'
FROM slots s
JOIN services_pick sv ON sv.sn = s.svc_idx
JOIN clients_seq c ON c.cn = s.cli_idx
ON CONFLICT DO NOTHING;

-- Future confirmed: 20 bookings на следующие 14 дней
WITH days AS (
  SELECT generate_series(CURRENT_DATE, CURRENT_DATE + 13, INTERVAL '1 day')::date AS d
),
masters AS (
  SELECT id, ROW_NUMBER() OVER () AS mn FROM salons.masters
  WHERE company_id = :'companyId' AND is_active = TRUE
),
clients_seq AS (
  SELECT id, phone, full_name, ROW_NUMBER() OVER () AS cn
  FROM clients.clients
  WHERE company_id = :'companyId' AND comment LIKE '[seed]%'
),
services_pick AS (
  SELECT id, name, price, duration_minutes, ROW_NUMBER() OVER () AS sn
  FROM salons.services WHERE company_id = :'companyId' AND is_active = TRUE
),
slots AS (
  -- 1-2 записи на день: master_index=1,3 (т.е. 2 из 4 мастеров через день)
  SELECT
    d.d AS work_date,
    m.id AS master_id,
    ('11:00'::time + (m.mn - 1) * INTERVAL '3 hours')::time AS start_time,
    ((extract(epoch FROM d.d)::bigint / 86400 + m.mn + 100) % 18 + 1)::int AS svc_idx,
    ((extract(epoch FROM d.d)::bigint / 86400 * 4 + m.mn + 50) % 30 + 1)::int AS cli_idx
  FROM days d CROSS JOIN masters m
  WHERE m.mn IN (1, 3)  -- только 2 из 4 мастеров
    AND extract(dow FROM d.d) != 0  -- кроме воскресенья
)
INSERT INTO bookings.bookings
  (company_id, master_id, client_id, client_phone, client_name,
   starts_at, ends_at, status, total_price, source, notes)
SELECT
  :'companyId',
  s.master_id,
  c.id,
  c.phone,
  c.full_name,
  (s.work_date::text || 'T' || s.start_time::text || '+03:00')::timestamptz,
  (s.work_date::text || 'T' || s.start_time::text || '+03:00')::timestamptz + (sv.duration_minutes::text || ' minutes')::interval,
  'confirmed',
  sv.price,
  'admin',
  '[seed] auto'
FROM slots s
JOIN services_pick sv ON sv.sn = s.svc_idx
JOIN clients_seq c ON c.cn = s.cli_idx
ON CONFLICT DO NOTHING;

-- Snapshot booking_services для каждой созданной записи (одна услуга = одна запись)
INSERT INTO bookings.booking_services (booking_id, service_id, service_name, price, duration_minutes, sort_order)
SELECT b.id, sv.id, sv.name, b.total_price, sv.duration_minutes, 0
FROM bookings.bookings b
JOIN salons.services sv ON sv.company_id = b.company_id AND sv.price = b.total_price AND sv.is_active = TRUE
WHERE b.company_id = :'companyId' AND b.notes LIKE '[seed]%'
  AND NOT EXISTS (SELECT 1 FROM bookings.booking_services bs WHERE bs.booking_id = b.id)
ON CONFLICT DO NOTHING;

-- ============================================================
-- 5. FINANCE OPERATIONS — чистим [seed] и вставляем историю
-- ============================================================
-- Снимаем with-trigger балансы, потом пересчитаем.
DELETE FROM finance.operations
WHERE company_id = :'companyId' AND note LIKE '[seed]%';

WITH acc AS (
  SELECT id, name FROM finance.accounts WHERE company_id = :'companyId' ORDER BY created_at LIMIT 2
),
acc_cash AS (SELECT id FROM acc LIMIT 1),
acc_bank AS (SELECT id FROM acc OFFSET 1 LIMIT 1),
cat_in_kassa  AS (SELECT id FROM finance.cashflow_categories WHERE company_id = :'companyId' AND name = 'Касса' AND kind='income' LIMIT 1),
cat_in_acq    AS (SELECT id FROM finance.cashflow_categories WHERE company_id = :'companyId' AND name = 'Эквайринг' AND kind='income' LIMIT 1),
cat_ex_rent   AS (SELECT id FROM finance.cashflow_categories WHERE company_id = :'companyId' AND name = 'Аренда' AND kind='expense' LIMIT 1),
cat_ex_mat    AS (SELECT id FROM finance.cashflow_categories WHERE company_id = :'companyId' AND name = 'Расходники' AND kind='expense' LIMIT 1),
cat_ex_ad     AS (SELECT id FROM finance.cashflow_categories WHERE company_id = :'companyId' AND name = 'Реклама' AND kind='expense' LIMIT 1)
INSERT INTO finance.operations
  (company_id, account_id, kind, category_id, amount, op_date, note, created_by_user_id)
SELECT :'companyId', a.acc_id, o.kind, o.cat_id, o.amount, o.op_date::date, '[seed] ' || o.note, :'ownerId'
FROM (
  SELECT 'income'::text  AS kind, (SELECT id FROM cat_in_kassa)  AS cat_id, 12000::numeric AS amount, (CURRENT_DATE - 25)::text AS op_date, 'Услуги наличными' AS note, 'cash' AS acc
  UNION ALL SELECT 'income',  (SELECT id FROM cat_in_acq),   85000, (CURRENT_DATE - 24)::text, 'Эквайринг день',      'bank'
  UNION ALL SELECT 'income',  (SELECT id FROM cat_in_kassa), 18000, (CURRENT_DATE - 22)::text, 'Услуги наличными',    'cash'
  UNION ALL SELECT 'expense', (SELECT id FROM cat_ex_rent), 150000, (CURRENT_DATE - 20)::text, 'Аренда апрель',       'bank'
  UNION ALL SELECT 'income',  (SELECT id FROM cat_in_acq),   62000, (CURRENT_DATE - 18)::text, 'Эквайринг день',      'bank'
  UNION ALL SELECT 'expense', (SELECT id FROM cat_ex_mat),   24000, (CURRENT_DATE - 17)::text, 'Закупка расходников', 'bank'
  UNION ALL SELECT 'income',  (SELECT id FROM cat_in_kassa), 22000, (CURRENT_DATE - 15)::text, 'Услуги наличными',    'cash'
  UNION ALL SELECT 'income',  (SELECT id FROM cat_in_acq),   91000, (CURRENT_DATE - 14)::text, 'Эквайринг день',      'bank'
  UNION ALL SELECT 'expense', (SELECT id FROM cat_ex_ad),    18000, (CURRENT_DATE - 12)::text, 'Instagram реклама',   'bank'
  UNION ALL SELECT 'income',  (SELECT id FROM cat_in_kassa), 15000, (CURRENT_DATE - 10)::text, 'Услуги наличными',    'cash'
  UNION ALL SELECT 'income',  (SELECT id FROM cat_in_acq),   77000, (CURRENT_DATE - 8)::text,  'Эквайринг день',      'bank'
  UNION ALL SELECT 'expense', (SELECT id FROM cat_ex_mat),    9500, (CURRENT_DATE - 7)::text,  'Чистовье поставка',   'bank'
  UNION ALL SELECT 'income',  (SELECT id FROM cat_in_kassa), 28000, (CURRENT_DATE - 5)::text,  'Услуги наличными',    'cash'
  UNION ALL SELECT 'income',  (SELECT id FROM cat_in_acq),   54000, (CURRENT_DATE - 3)::text,  'Эквайринг день',      'bank'
  UNION ALL SELECT 'expense', (SELECT id FROM cat_ex_mat),    6800, (CURRENT_DATE - 1)::text,  'Расходники аптека',   'bank'
) AS o
JOIN (SELECT 'cash' AS k, (SELECT id FROM acc_cash) AS acc_id UNION ALL SELECT 'bank', (SELECT id FROM acc_bank)) a ON a.k = o.acc;

-- Пересчёт current_balance через operations + initial_balance (точная синхронизация)
UPDATE finance.accounts a
SET current_balance = a.initial_balance + COALESCE((
  SELECT SUM(CASE
    WHEN kind IN ('income', 'transfer_in') THEN amount
    WHEN kind IN ('expense', 'transfer_out') THEN -amount
    WHEN kind = 'adjust' THEN amount
    ELSE 0 END)
  FROM finance.operations
  WHERE account_id = a.id AND is_deleted = FALSE
), 0)
WHERE a.company_id = :'companyId';

-- ============================================================
-- 6. SALARY SCHEMES — по схеме на каждого мастера
-- Удаляем seed-схемы (отмечены [seed] в notes), кладём новые.
-- ============================================================
-- Сначала payouts → потом accruals → потом schemes (FK-связи отсутствуют, но логично)
DELETE FROM salary.payouts
WHERE company_id = :'companyId' AND note LIKE '[seed]%';
DELETE FROM salary.accruals
WHERE company_id = :'companyId' AND (note LIKE '[seed]%' OR source LIKE '[seed]%');
DELETE FROM salary.schemes
WHERE company_id = :'companyId' AND notes LIKE '[seed]%';

-- 4 схемы: rate / rate_plus_percent / percent_only / rate (разные конфиги)
INSERT INTO salary.schemes
  (company_id, master_id, scheme_type, rate_amount, rate_period,
   percent_services, percent_goods, apply_discount, guaranteed,
   effective_from, notes)
SELECT :'companyId', m.id,
       CASE m.rn
         WHEN 1 THEN 'rate_plus_percent'
         WHEN 2 THEN 'percent_only'
         WHEN 3 THEN 'rate'
         ELSE 'rate_plus_percent'
       END,
       CASE m.rn WHEN 2 THEN 0 WHEN 3 THEN 60000 ELSE 30000 END,
       'month',
       CASE m.rn WHEN 1 THEN 30 WHEN 2 THEN 40 WHEN 3 THEN 0 ELSE 25 END,
       0,
       FALSE,
       CASE m.rn WHEN 4 THEN 25000 ELSE 0 END,
       (CURRENT_DATE - 60)::date,
       '[seed] базовая схема'
FROM (
  SELECT id, ROW_NUMBER() OVER (ORDER BY display_name) AS rn
  FROM salons.masters
  WHERE company_id = :'companyId' AND is_active = TRUE
) m
ON CONFLICT DO NOTHING;

-- Несколько ручных начислений (бонусы/штрафы)
INSERT INTO salary.accruals
  (company_id, master_id, amount, source_kind, source, period_from, period_to, note, created_by_user_id)
SELECT :'companyId', m.id, a.amount, a.kind, '[seed] ' || a.src, NULL, NULL, '[seed] auto', :'ownerId'
FROM (
  SELECT 1 AS rn, 5000::numeric AS amount, 'bonus'::text AS kind,   'Премия за высокую конверсию' AS src
  UNION ALL SELECT 2, 3500,  'bonus',   'Премия за отзыв клиента'
  UNION ALL SELECT 3, -1500, 'penalty', 'Штраф: опоздание 25.04'
  UNION ALL SELECT 4, 2000,  'bonus',   'Премия за дополнительную смену'
) a
JOIN (
  SELECT id, ROW_NUMBER() OVER (ORDER BY display_name) AS rn
  FROM salons.masters
  WHERE company_id = :'companyId' AND is_active = TRUE
) m USING (rn);

-- ============================================================
-- Final summary
-- ============================================================
SELECT 'masters'              AS tbl, COUNT(*) AS n FROM salons.masters             WHERE company_id = :'companyId'
UNION ALL SELECT 'service_categories',  COUNT(*) FROM salons.service_categories     WHERE company_id = :'companyId'
UNION ALL SELECT 'services',            COUNT(*) FROM salons.services               WHERE company_id = :'companyId'
UNION ALL SELECT 'clients',             COUNT(*) FROM clients.clients               WHERE company_id = :'companyId' AND is_deleted = FALSE
UNION ALL SELECT 'master_schedules',    COUNT(*) FROM salons.master_schedules       WHERE company_id = :'companyId'
UNION ALL SELECT 'bookings',            COUNT(*) FROM bookings.bookings             WHERE company_id = :'companyId'
UNION ALL SELECT '  → completed',       COUNT(*) FROM bookings.bookings             WHERE company_id = :'companyId' AND status = 'completed'
UNION ALL SELECT '  → confirmed',       COUNT(*) FROM bookings.bookings             WHERE company_id = :'companyId' AND status = 'confirmed'
UNION ALL SELECT 'finance.accounts',    COUNT(*) FROM finance.accounts              WHERE company_id = :'companyId'
UNION ALL SELECT 'finance.operations',  COUNT(*) FROM finance.operations            WHERE company_id = :'companyId' AND is_deleted = FALSE
UNION ALL SELECT 'finance.categories',  COUNT(*) FROM finance.cashflow_categories   WHERE company_id = :'companyId' AND is_active = TRUE
UNION ALL SELECT 'salary.schemes',      COUNT(*) FROM salary.schemes                WHERE company_id = :'companyId'
UNION ALL SELECT 'salary.accruals',     COUNT(*) FROM salary.accruals               WHERE company_id = :'companyId'
UNION ALL SELECT 'salary.payouts',      COUNT(*) FROM salary.payouts                WHERE company_id = :'companyId';
