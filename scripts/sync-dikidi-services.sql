-- Синхронизация каталога услуг с DIKIDI (компания Samaya, company=1674757,
-- снимок вкладки «Услуги» → фильтр «Активные», 90 позиций, от 2026-08-05).
--
-- Что делает:
--   1. заводит категории «Лазерная липосакция» и «Фейс тайт» (в DIKIDI они есть,
--      в samaya их роль играли выдуманные «Хирургия» и «Инъекционная косметология»);
--   2. добавляет 18 услуг, которых в samaya не было;
--   3. правит цену «ЛЛ внутренняя поверхность ног» (150 000 → 200 000 по DIKIDI);
--   4. раскладывает услуги по категориям так же, как в DIKIDI, и убирает
--      опустевшие «Хирургия» / «Инъекционная косметология»;
--   5. гасит то, чего в DIKIDI нет: «Эпиляция дио» (дубль Diolaze) и вторую
--      «Консультацию» за 0 ₽; удаляет «__TEST__ услуга»;
--   6. пересобирает привязки мастеров ровно как в DIKIDI:
--      Балакеримова Зухра — 35, Магомедова Наида — 58, Курбанова Жасмина — 56.
--
-- Идемпотентно: повторный прогон ничего не дублирует.
-- Цены «от N» в DIKIDI — это флаг плавающей цены у сотрудника (floating[master]),
-- отдельного поля в samaya нет, поэтому переносится само число.

\set company '00000000-0000-0000-0000-000000000001'

BEGIN;

-- ---------------------------------------------------------------- 1. категории

INSERT INTO salons.service_categories (company_id, name, sort_order)
SELECT :'company', v.name, v.sort_order
FROM (VALUES ('Лазерная липосакция', 10), ('Фейс тайт', 20)) AS v(name, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM salons.service_categories c
  WHERE c.company_id = :'company' AND c.name = v.name
);

-- ------------------------------------------------------------- 2. новые услуги

WITH src(category, name, duration_minutes, price) AS (
  VALUES
    -- Лазерная липосакция (в DIKIDI 12 позиций, у нас была только одна)
    ('Лазерная липосакция', 'ЛЛ ног',                            120, 400000),
    ('Лазерная липосакция', 'ЛЛ талии',                           90, 250000),
    ('Лазерная липосакция', 'ЛЛ уменьшение ягодиц',               45, 250000),
    ('Лазерная липосакция', 'ЛЛ рук',                             90, 200000),
    ('Лазерная липосакция', 'ЛЛ живота',                          90, 200000),
    ('Лазерная липосакция', 'ЛЛ галифе',                          40, 150000),
    ('Лазерная липосакция', 'ЛЛ холки с плечиками',               60, 150000),
    ('Лазерная липосакция', 'ЛЛ холки',                           45, 100000),
    ('Лазерная липосакция', 'ЛЛ лобка',                           20, 100000),
    ('Лазерная липосакция', 'ЛЛ подмышечных зон',                 45, 100000),
    ('Лазерная липосакция', 'ЛЛ подбородка, овала лица, брылей',  30, 100000),
    -- Фейс тайт
    ('Фейс тайт',           'Фейс тайт',                          45,  30000),
    -- Контурная пластика (инъекционная часть каталога DIKIDI)
    ('Контурная пластика',  'Ботокс - Trap tox',                  15,  20000),
    ('Контурная пластика',  'Ботокс - Лифтинг Нефертити',         15,  15000),
    ('Контурная пластика',  'Ботокс - Лечение гипергидроза',      15,  15000),
    ('Контурная пластика',  'Ботокс - Лечение бруксизма',         15,   7000),
    ('Контурная пластика',  'Коктейль Монако',                    15,  15000),
    ('Контурная пластика',  'Коррекция ботокса',                  10,      1)
)
INSERT INTO salons.services
  (company_id, category_id, name, duration_minutes, price, is_active, show_in_menu)
SELECT :'company', c.id, s.name, s.duration_minutes, s.price, TRUE, TRUE
FROM src s
JOIN salons.service_categories c
  ON c.company_id = :'company' AND c.name = s.category
WHERE NOT EXISTS (
  SELECT 1 FROM salons.services x
  WHERE x.company_id = :'company' AND x.name = s.name
);

-- ------------------------------------------------------- 2b. ЧПУ новых услуг

-- Без slug услуга не попадает в публичный каталог: site.ts фильтрует
-- по `show_in_menu = TRUE AND slug IS NOT NULL`. Значения — тот же
-- транслит, что даёт slugify() из salon-service/src/slug.ts.

WITH src(name, slug) AS (
  VALUES
    ('ЛЛ ног',                            'll-nog'),
    ('ЛЛ талии',                          'll-talii'),
    ('ЛЛ уменьшение ягодиц',              'll-umen-shenie-yagodic'),
    ('ЛЛ рук',                            'll-ruk'),
    ('ЛЛ живота',                         'll-zhivota'),
    ('ЛЛ галифе',                         'll-galife'),
    ('ЛЛ холки с плечиками',              'll-kholki-s-plechikami'),
    ('ЛЛ холки',                          'll-kholki'),
    ('ЛЛ лобка',                          'll-lobka'),
    ('ЛЛ подмышечных зон',                'll-podmyshechnykh-zon'),
    ('ЛЛ подбородка, овала лица, брылей', 'll-podborodka-ovala-lica-brylej'),
    ('Фейс тайт',                         'fejs-tajt'),
    ('Ботокс - Trap tox',                 'botoks-trap-tox'),
    ('Ботокс - Лифтинг Нефертити',        'botoks-lifting-nefertiti'),
    ('Ботокс - Лечение гипергидроза',     'botoks-lechenie-gipergidroza'),
    ('Ботокс - Лечение бруксизма',        'botoks-lechenie-bruksizma'),
    ('Коктейль Монако',                   'koktejl-monako'),
    ('Коррекция ботокса',                 'korrekciya-botoksa')
)
UPDATE salons.services s
SET slug = src.slug, updated_at = now()
FROM src
WHERE s.company_id = :'company' AND s.name = src.name AND s.slug IS NULL;

-- ----------------------------------------------------------- 3. цена по DIKIDI

UPDATE salons.services
SET price = 200000, updated_at = now()
WHERE company_id = :'company'
  AND name = 'ЛЛ внутренняя поверхность ног'
  AND price <> 200000;

-- ------------------------------------------------ 4. категории как в DIKIDI

-- ЛЛ внутренняя поверхность ног: «Хирургия» → «Лазерная липосакция»
UPDATE salons.services s
SET category_id = c.id, updated_at = now()
FROM salons.service_categories c
WHERE c.company_id = :'company' AND c.name = 'Лазерная липосакция'
  AND s.company_id = :'company'
  AND s.name = 'ЛЛ внутренняя поверхность ног'
  AND s.category_id IS DISTINCT FROM c.id;

-- Боди Тайт: «Хирургия» → «Фейс тайт» (в DIKIDI обе позиции в одной категории)
UPDATE salons.services s
SET category_id = c.id, updated_at = now()
FROM salons.service_categories c
WHERE c.company_id = :'company' AND c.name = 'Фейс тайт'
  AND s.company_id = :'company'
  AND s.name = 'Боди Тайт'
  AND s.category_id IS DISTINCT FROM c.id;

-- Липосакция рук и Архитектура лица: в DIKIDI лежат в «Без категории»
UPDATE salons.services s
SET category_id = c.id, updated_at = now()
FROM salons.service_categories c
WHERE c.company_id = :'company' AND c.name = 'Без категории'
  AND s.company_id = :'company'
  AND s.name IN ('Липосакция рук', 'Архитектура лица')
  AND s.category_id IS DISTINCT FROM c.id;

-- «Инъекционная косметология» → «Контурная пластика» (в DIKIDI всё это одна категория)
UPDATE salons.services s
SET category_id = dst.id, updated_at = now()
FROM salons.service_categories src, salons.service_categories dst
WHERE src.company_id = :'company' AND src.name = 'Инъекционная косметология'
  AND dst.company_id = :'company' AND dst.name = 'Контурная пластика'
  AND s.company_id = :'company'
  AND s.category_id = src.id;

-- опустевшие выдуманные категории
DELETE FROM salons.service_categories c
WHERE c.company_id = :'company'
  AND c.name IN ('Хирургия', 'Инъекционная косметология')
  AND NOT EXISTS (SELECT 1 FROM salons.services s WHERE s.category_id = c.id);

-- -------------------------------------------------- 5. чего в DIKIDI нет

-- дубль «Лазерная эпиляция Diolaze»; на услугу ссылается акция, поэтому гасим, а не удаляем
UPDATE salons.services
SET is_active = FALSE, show_in_menu = FALSE, updated_at = now()
WHERE company_id = :'company' AND name = 'Эпиляция дио' AND is_active;

-- вторая «Консультация» за 0 ₽ (в DIKIDI одна, за 500 ₽); записей на неё нет
UPDATE salons.services
SET is_active = FALSE, show_in_menu = FALSE, updated_at = now()
WHERE company_id = :'company' AND name = 'Консультация' AND price = 0 AND is_active;

-- тестовая услуга на проде, ни одной ссылки
DELETE FROM salons.services
WHERE company_id = :'company' AND name = '__TEST__ услуга';

-- тестовое переопределение цены (777 ₽ у Наиды на Diolaze), в DIKIDI переопределений нет
UPDATE salons.master_services
SET custom_price = NULL
WHERE custom_price = 777;

-- ------------------------------------------- 6. кто какие услуги оказывает

-- В DIKIDI аппаратная косметология и эпиляция — на Наиде и Жасмине,
-- инъекции, липосакция и тайты — только на Балакеримовой (она врач).
CREATE TEMP TABLE dikidi_zuhra_only(name text) ON COMMIT DROP;
INSERT INTO dikidi_zuhra_only(name) VALUES
  ('Липосакция рук'),
  ('Увеличение губ'),
  ('Увлажнение полимолочной кислотой (лицо)'),
  ('Увлажнение полимолочной кислотой (лицо, шея)'),
  ('Увлажнение полимолочной кислотой (руки)'),
  ('ЛЛ внутренняя поверхность ног'),
  ('ЛЛ ног'),
  ('ЛЛ талии'),
  ('ЛЛ уменьшение ягодиц'),
  ('ЛЛ рук'),
  ('ЛЛ живота'),
  ('ЛЛ галифе'),
  ('ЛЛ холки с плечиками'),
  ('ЛЛ холки'),
  ('ЛЛ лобка'),
  ('ЛЛ подмышечных зон'),
  ('ЛЛ подбородка, овала лица, брылей'),
  ('Боди Тайт'),
  ('Фейс тайт'),
  ('Архитектура лица'),
  ('Биоревитализация'),
  ('Коррекция ботокса'),
  ('Коктейль Монако'),
  ('Ботокс - верхняя треть (лоб, межбровье, вокруг глаз, переносица)'),
  ('Ботокс - средняя треть и платизма'),
  ('Ботокс - Louboutin'),
  ('Ботокс - Trap tox'),
  ('Ботокс - Лифтинг Нефертити'),
  ('Ботокс - Лечение бруксизма'),
  ('Ботокс - Лечение гипергидроза');

CREATE TEMP TABLE dikidi_links(master_id uuid, service_id uuid) ON COMMIT DROP;

INSERT INTO dikidi_links(master_id, service_id)
-- Балакеримова Зухра: свои 30 + то, что делит с косметологами
SELECT m.id, s.id
FROM salons.services s, salons.masters m
WHERE s.company_id = :'company' AND s.is_active
  AND m.company_id = :'company' AND m.display_name = 'Балакеримова Зухра'
  AND (s.name IN (SELECT name FROM dikidi_zuhra_only)
       OR s.name IN ('Осмотр',
                     'Консультация',
                     'INMODE MORPHEUS 8 - лицо+шея+декольте',
                     'INMODE MORPHEUS 8 - лицо+шея+декольте+кисти рук',
                     'INMODE MORPHEUS 8 - ягодицы'))
UNION ALL
-- Магомедова Наида: всё, кроме врачебного, кроме ягодиц Morpheus
SELECT m.id, s.id
FROM salons.services s, salons.masters m
WHERE s.company_id = :'company' AND s.is_active
  AND m.company_id = :'company' AND m.display_name = 'Магомедова Наида'
  AND s.name NOT IN (SELECT name FROM dikidi_zuhra_only)
  AND s.name <> 'INMODE MORPHEUS 8 - ягодицы'
UNION ALL
-- Курбанова Жасмина: то же, минус компрессионное белье, Morpheus 8 лицо и осмотр
SELECT m.id, s.id
FROM salons.services s, salons.masters m
WHERE s.company_id = :'company' AND s.is_active
  AND m.company_id = :'company' AND m.display_name = 'Курбанова Жасмина'
  AND s.name NOT IN (SELECT name FROM dikidi_zuhra_only)
  AND s.name NOT IN ('Компрессионное белье', 'INMODE MORPHEUS 8 лицо', 'Осмотр');

-- лишние привязки у трёх мастеров, которые оказывают услуги
DELETE FROM salons.master_services ms
USING salons.masters m
WHERE ms.master_id = m.id
  AND m.company_id = :'company'
  AND m.display_name IN ('Балакеримова Зухра', 'Магомедова Наида', 'Курбанова Жасмина')
  AND NOT EXISTS (
    SELECT 1 FROM dikidi_links l
    WHERE l.master_id = ms.master_id AND l.service_id = ms.service_id
  );

-- недостающие
INSERT INTO salons.master_services (master_id, service_id)
SELECT l.master_id, l.service_id
FROM dikidi_links l
ON CONFLICT DO NOTHING;

COMMIT;

-- ------------------------------------------------------------------- проверка

\pset pager off
SELECT count(*) FILTER (WHERE is_active) AS active_services,
       count(*) FILTER (WHERE is_active AND slug IS NULL) AS active_without_slug
FROM salons.services;

SELECT m.display_name, count(*) AS services
FROM salons.master_services ms
JOIN salons.masters m ON m.id = ms.master_id
GROUP BY m.display_name
ORDER BY 2 DESC;

SELECT c.name AS category, count(s.id) AS services
FROM salons.service_categories c
LEFT JOIN salons.services s ON s.category_id = c.id AND s.is_active
GROUP BY c.name
ORDER BY 2 DESC, 1;
