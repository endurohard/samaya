-- 063_integration_credentials.sql
--
-- Учётные данные внешних интеграций (токен Instagram Graph API и то, что
-- появится следом).
--
-- Зачем отдельная таблица, а не salons.company_profile.settings_jsonb:
-- GET /api/salons/company отдаёт settings_jsonb целиком любому
-- аутентифицированному сотруднику — там лежат настройки уведомлений и
-- бонусной программы, и доступ к ним нужен всем ролям. Токен доступа к
-- переписке клиентов в такой выдаче оказался бы у каждого мастера.
-- Отдельная таблица позволяет закрыть чтение ролью и никогда не отдавать
-- значение наружу: наружу уходит только маска и факт наличия.
--
--   provider    — какая интеграция. Строкой, а не enum: добавление нового
--                 провайдера не должно требовать миграции типа.
--   token       — сам секрет. Хранится как есть: шифровать его ключом,
--                 который лежит в том же .env на той же машине, значит
--                 добавить работы без выигрыша в безопасности.
--   meta        — несекретное сопровождение (id аккаунта, username, версия
--                 API, срок годности): его можно показывать в интерфейсе,
--                 не раскрывая токен.
--   expires_at  — когда токен протухнет. Долгоживущий токен Meta живёт 60
--                 дней, и «бот молчит» на 61-й день — это то, о чём
--                 администратор должен узнать заранее, а не по жалобам.

SET search_path TO salons, public;

CREATE TABLE IF NOT EXISTS integration_credentials (
  company_id   UUID        NOT NULL,
  provider     TEXT        NOT NULL,
  token        TEXT,
  meta         JSONB       NOT NULL DEFAULT '{}',
  expires_at   TIMESTAMPTZ,
  -- Кто последним менял: при разборе «почему перестало работать» первым
  -- делом выясняется, не перевыпустил ли кто-то токен вручную.
  updated_by   UUID,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, provider)
);

DROP TRIGGER IF EXISTS trg_integration_credentials_upd ON integration_credentials;
CREATE TRIGGER trg_integration_credentials_upd BEFORE UPDATE ON integration_credentials
  FOR EACH ROW EXECUTE FUNCTION salons.set_updated_at();

COMMENT ON TABLE integration_credentials IS
  'Секреты внешних интеграций. Значение token наружу не отдаётся — только маска и факт наличия.';
COMMENT ON COLUMN integration_credentials.meta IS
  'Несекретное сопровождение: id и username аккаунта, версия API, тип токена. Показывается в интерфейсе.';
