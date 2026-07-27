-- 041_service_site_menu.sql
--
-- Публичный каталог услуг на сайте (/services, /services/:slug):
--   show_in_menu — отображать услугу в меню/каталоге сайта (по умолчанию нет);
--   slug         — ЧПУ для страницы услуги, уникален внутри компании;
--   image_path   — изображение карточки, относительный путь в media
--                  (как video_path), напр. services/<id>.img.jpg.

SET search_path TO salons, public;

ALTER TABLE services
  ADD COLUMN IF NOT EXISTS show_in_menu BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS slug         TEXT,
  ADD COLUMN IF NOT EXISTS image_path   TEXT;

-- Бэкфилл slug для существующих услуг: транслитерация названия.
-- Однобуквенные замены — через translate(), многобуквенные — цепочкой replace().
WITH translit AS (
  SELECT id, company_id,
         regexp_replace(
           regexp_replace(
             translate(
               replace(replace(replace(replace(replace(replace(replace(replace(
                 lower(name),
                 'ж', 'zh'), 'ч', 'ch'), 'ш', 'sh'), 'щ', 'sch'),
                 'ю', 'yu'), 'я', 'ya'), 'ё', 'yo'), 'х', 'kh'),
               'абвгдезийклмнопрстуфцыьъэ +/',
               'abvgdezijklmnoprstufcy--e---'),
             '[^a-z0-9-]', '', 'g'),
           '-{2,}', '-', 'g') AS base_slug
  FROM services
  WHERE slug IS NULL
),
numbered AS (
  SELECT id,
         trim(BOTH '-' FROM base_slug) AS base_slug,
         ROW_NUMBER() OVER (
           PARTITION BY company_id, trim(BOTH '-' FROM base_slug) ORDER BY id
         ) AS rn
  FROM translit
)
UPDATE services s
SET slug = CASE
             WHEN n.base_slug = '' THEN 'service-' || left(s.id::text, 8)
             WHEN n.rn = 1 THEN n.base_slug
             ELSE n.base_slug || '-' || n.rn
           END
FROM numbered n
WHERE s.id = n.id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_services_company_slug
  ON services(company_id, slug) WHERE slug IS NOT NULL;

-- Публичная выборка каталога
CREATE INDEX IF NOT EXISTS idx_services_menu
  ON services(company_id) WHERE show_in_menu = TRUE AND is_active = TRUE;
