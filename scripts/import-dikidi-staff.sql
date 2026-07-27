-- Перенос сотрудников из DIKIDI (компания Samaya, снимок списка «Сотрудники»
-- от 2026-04-27, 12 человек) в salons.masters на прод.
-- Идемпотентно: сотрудник пропускается, если display_name уже есть у компании.
-- Телефон известен только у Балакеримовой (из скриншота карточки);
-- остальные добиваются позже из карточек DIKIDI.

BEGIN;

WITH src(display_name, first_name, last_name, position, category, phone, provides_services, sort_order) AS (
  VALUES
    ('Тагирова Джамиля',    'Джамиля',   'Тагирова',     'Администратор',        'Администратор', NULL,           FALSE, 10),
    ('Курбанова Жасмина',   'Жасмина',   'Курбанова',    'Врач-косметолог',      'Врач',          NULL,           TRUE,  20),
    ('Гидаят',              'Гидаят',    NULL,           'Ассистент',            'Ассистент',     NULL,           FALSE, 30),
    ('Бабаханова Анжела',   'Анжела',    'Бабаханова',   'Администратор',        'Администратор', NULL,           FALSE, 40),
    ('Рамазанова Джавгарат','Джавгарат', 'Рамазанова',   'Менеджер по продажам', 'Менеджер',      NULL,           FALSE, 50),
    ('Барскова Анна',       'Анна',      'Барскова',     'Ассистент',            'Ассистент',     NULL,           FALSE, 60),
    ('Мирзаева Пери',       'Пери',      'Мирзаева',     'Менеджер по продажам', 'Менеджер',      NULL,           FALSE, 70),
    ('Баширова Суайбат',    'Суайбат',   'Баширова',     'Менеджер по продажам', 'Менеджер',      NULL,           FALSE, 80),
    ('Магомедова Динара',   'Динара',    'Магомедова',   'SMM',                  'Маркетинг',     NULL,           FALSE, 90),
    ('Гаджиалиева Мадина',  'Мадина',    'Гаджиалиева',  'Маркетолог',           'Маркетинг',     NULL,           FALSE, 100),
    ('Балакеримова Зухра',  'Зухра',     'Балакеримова', 'Врач',                 'Врач',          '+79604080333', TRUE,  110)
)
INSERT INTO salons.masters
  (company_id, display_name, first_name, last_name, position, category,
   phone, provides_services, sort_order, is_active)
SELECT
  '00000000-0000-0000-0000-000000000001',
  s.display_name, s.first_name, s.last_name, s.position, s.category,
  s.phone, s.provides_services, s.sort_order, TRUE
FROM src s
WHERE NOT EXISTS (
  SELECT 1 FROM salons.masters m
  WHERE m.company_id = '00000000-0000-0000-0000-000000000001'
    AND m.display_name = s.display_name
);

-- Наида уже есть на проде: дозаполняем должность/категорию из DIKIDI, не трогая остальное
UPDATE salons.masters
SET position = COALESCE(position, 'Врач-косметолог'),
    category = COALESCE(category, 'Врач'),
    sort_order = 120
WHERE company_id = '00000000-0000-0000-0000-000000000001'
  AND display_name = 'Магомедова Наида';

-- Итог для контроля
SELECT display_name, position, category, phone, provides_services, sort_order
FROM salons.masters
WHERE company_id = '00000000-0000-0000-0000-000000000001'
  AND is_active
ORDER BY sort_order, display_name;

COMMIT;
