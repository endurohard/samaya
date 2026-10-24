-- 072_ai_price_list.sql
--
-- Прайс лазерной липосакции — в БД, чтобы владелец правил цены в админке.
--
-- Почему прайс изначально лежал литералами в price.ts: цену нельзя
-- «сочинить», и таблица чисел в коде под тестами давала эту гарантию. Но
-- гарантию даёт не расположение файла, а то, что цена БЕРЁТСЯ ИЗ ТАБЛИЦЫ,
-- а не генерируется моделью. Таблица в БД это свойство сохраняет, а правку
-- цен перестаёт привязывать к выкладке: цены клиника меняет чаще, чем
-- выходит релиз, и каждый раз звать разработчика неправильно.
--
-- Две таблицы, а не одна: у части зон цена фиксированная, у части —
-- ступенями по весу. Складывать то и другое в одну строку значило бы
-- держать пять пустых колонок у двенадцати зон из двадцати четырёх.
--
-- Цены здесь — ровно те, что были в коде на момент переноса (сверено с
-- price.ts). Границы ступеней тоже: 100 кг относится к ступени 100-109,
-- талия приведена к ступеням живота — это согласовано с владельцем и
-- менять при переносе нельзя.

SET search_path TO ai, public;

-- ===== Зоны =====
CREATE TABLE IF NOT EXISTS ai.price_zones (
  company_id  UUID        NOT NULL,
  -- Ключ зоны: он же ZoneKey в коде и значение в ai.price_dialog.zones.
  -- Латиницей и неизменяемый: на него завязано состояние живых разговоров.
  zone_key    TEXT        NOT NULL,
  -- Название, которое видит клиент в ответе.
  title       TEXT        NOT NULL,
  -- Зависит ли цена от веса. У фиксированных зон (подбородок, галифе)
  -- спрашивать вес незачем — опросник читает именно этот флаг.
  by_weight   BOOLEAN     NOT NULL DEFAULT FALSE,
  -- Фиксированная цена по городам; NULL у зон со ступенями.
  price_kaspiysk NUMERIC(12,2) NULL,
  price_moscow   NUMERIC(12,2) NULL,
  -- Примечание рядом с ценой («плечики в подарок»).
  note        TEXT        NULL,
  -- Выключенная зона не предлагается и не считается: сезонную услугу
  -- убирают из прайса, а не удаляют — иначе теряется история разговоров,
  -- где она уже названа.
  enabled     BOOLEAN     NOT NULL DEFAULT TRUE,
  sort_order  INT         NOT NULL DEFAULT 100,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, zone_key),
  -- Зона либо фиксированная с обеими ценами, либо весовая без них.
  -- Без этой проверки «забыл заполнить цену по Москве» проявится молчанием
  -- ассистента на боевом вопросе, а не ошибкой при сохранении.
  CONSTRAINT price_zones_price_shape CHECK (
    (by_weight AND price_kaspiysk IS NULL AND price_moscow IS NULL)
    OR (NOT by_weight AND price_kaspiysk IS NOT NULL AND price_moscow IS NOT NULL)
  )
);

DROP TRIGGER IF EXISTS trg_ai_price_zones_upd ON ai.price_zones;
CREATE TRIGGER trg_ai_price_zones_upd BEFORE UPDATE ON ai.price_zones
  FOR EACH ROW EXECUTE FUNCTION ai.set_updated_at();

-- ===== Ступени по весу =====
CREATE TABLE IF NOT EXISTS ai.price_steps (
  company_id  UUID        NOT NULL,
  zone_key    TEXT        NOT NULL,
  -- Верхняя граница веса ВКЛЮЧИТЕЛЬНО. Последняя ступень — NULL
  -- («и выше»): так в админке не придётся писать 999, а в коде —
  -- сравнивать с магическим числом.
  max_weight  NUMERIC(5,1) NULL,
  price_kaspiysk NUMERIC(12,2) NOT NULL,
  price_moscow   NUMERIC(12,2) NOT NULL,
  sort_order  INT         NOT NULL DEFAULT 0,
  PRIMARY KEY (company_id, zone_key, sort_order),
  FOREIGN KEY (company_id, zone_key)
    REFERENCES ai.price_zones(company_id, zone_key) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ai_price_steps_zone
  ON ai.price_steps(company_id, zone_key, sort_order);

-- ===== Перенос текущего прайса =====
--
-- Идём от списка компаний, у которых уже есть шаблоны ассистента: прайс
-- нужен там же, где работает ассистент.
WITH co AS (SELECT DISTINCT company_id FROM ai.reply_templates),
z (zone_key, title, by_weight, pk, pm, note, sort_order) AS (VALUES
  ('chin',          'второй подбородок', FALSE, 150000, 200000, NULL, 10),
  ('contour_lift',  'Contour Lift (средняя и нижняя треть, шея, Morpheus 8 и FaceTite)', FALSE, 300000, 400000, NULL, 20),
  ('holka',         'холка', FALSE, 200000, 300000, 'плечики в подарок 🎁', 30),
  ('arms',          'круговая липосакция рук', TRUE, NULL, NULL, 'подмышечные зоны вместе с руками — плюс 50 000 ₽', 40),
  ('belly',         'живот', TRUE, NULL, NULL, 'живот вместе с лобком — плюс 50 000 ₽', 50),
  ('waist',         'талия', TRUE, NULL, NULL, NULL, 60),
  ('legs_circular', 'круговая липосакция ног (от колен и выше)', FALSE, 700000, 800000, NULL, 70),
  ('inner_legs',    'внутренняя поверхность ног до колен', FALSE, 300000, 350000, NULL, 80),
  ('galife',        'галифе', FALSE, 250000, 300000, NULL, 90),
  ('pubis',         'лобок', FALSE, 200000, 200000, NULL, 100),
  ('shin',          'голень (круговая)', FALSE, 350000, 600000, NULL, 110),
  ('buttocks',      'уменьшение ягодиц', FALSE, 350000, 400000, NULL, 120)
)
INSERT INTO ai.price_zones
  (company_id, zone_key, title, by_weight, price_kaspiysk, price_moscow, note, sort_order)
SELECT co.company_id, z.zone_key, z.title, z.by_weight,
       z.pk::numeric, z.pm::numeric, z.note, z.sort_order
  FROM co CROSS JOIN z
ON CONFLICT (company_id, zone_key) DO NOTHING;

WITH co AS (SELECT DISTINCT company_id FROM ai.reply_templates),
s (zone_key, max_weight, pk, pm, sort_order) AS (VALUES
  -- руки
  ('arms',  85,   250000, 300000, 0),
  ('arms',  NULL, 300000, 350000, 1),
  -- живот
  ('belly', 75,   250000, 350000, 0),
  ('belly', 99,   300000, 400000, 1),
  ('belly', 109,  350000, 500000, 2),
  ('belly', 118,  400000, 550000, 3),
  ('belly', NULL, 500000, 600000, 4),
  -- талия
  ('waist', 75,   300000, 400000, 0),
  ('waist', 99,   400000, 500000, 1),
  ('waist', 109,  500000, 600000, 2),
  ('waist', 118,  600000, 700000, 3),
  ('waist', NULL, 700000, 800000, 4)
)
INSERT INTO ai.price_steps
  (company_id, zone_key, max_weight, price_kaspiysk, price_moscow, sort_order)
SELECT co.company_id, s.zone_key, s.max_weight::numeric,
       s.pk::numeric, s.pm::numeric, s.sort_order
  FROM co CROSS JOIN s
ON CONFLICT (company_id, zone_key, sort_order) DO NOTHING;
