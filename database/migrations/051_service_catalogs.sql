-- 051_service_catalogs.sql
--
-- Каталоги услуг по ссылке: подборка услуг, которую администратор собирает
-- вручную и отправляет клиенту одной ссылкой /c/<token>.
-- В отличие от сайта (/services, только show_in_menu), в каталог можно
-- добавить любую активную услугу — и не светить её в общем меню.
--
--   service_catalogs      — сам каталог: имя, вводный текст, токен ссылки,
--                           счётчик открытий, is_active (выключенная ссылка → 404).
--   service_catalog_items — состав каталога с порядком.

SET search_path TO salons, public;

CREATE TABLE IF NOT EXISTS service_catalogs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  UUID NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  token       TEXT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  views       INT NOT NULL DEFAULT 0,
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_service_catalogs_token ON service_catalogs(token);
CREATE INDEX IF NOT EXISTS idx_service_catalogs_company ON service_catalogs(company_id, created_at DESC);

CREATE TABLE IF NOT EXISTS service_catalog_items (
  catalog_id  UUID NOT NULL REFERENCES service_catalogs(id) ON DELETE CASCADE,
  service_id  UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  sort_order  INT NOT NULL DEFAULT 0,
  PRIMARY KEY (catalog_id, service_id)
);

CREATE INDEX IF NOT EXISTS idx_service_catalog_items_service ON service_catalog_items(service_id);
