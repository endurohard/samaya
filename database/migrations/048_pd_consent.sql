-- 048_pd_consent.sql
--
-- Согласие на обработку персональных данных (152-ФЗ).
--
-- Формы онлайн-записи, виджета и лендингов акций собирают имя, телефон и email —
-- это персональные данные, и оператор обязан по требованию доказать, что
-- согласие было получено. Галочки в форме для этого мало: она живёт в браузере
-- клиента и после сабмита не остаётся нигде. Доказательство — строка здесь:
-- когда, с какого адреса, на какую редакцию политики и в какой форме.
--
-- Отдельная таблица, а не флаг в карточке: клиент может согласиться несколько
-- раз (записался онлайн, потом забрал купон), редакция политики со временем
-- меняется, и нужна вся история, а не последнее состояние. На карточке при
-- этом остаётся денормализованный pd_consent_at — чтобы список клиентов не
-- джойнил лог на каждой строке ради одной даты.
--
-- Без FK на clients.clients: строка пишется даже когда карточку создать не
-- удалось (findOrCreateClientId возвращает null) — иначе именно в этом случае
-- пропадёт доказательство согласия, хотя данные клиента мы уже приняли.
-- Связь тогда держится по (company_id, phone), как и везде в проекте.

SET search_path TO clients, public;

CREATE TABLE IF NOT EXISTS pd_consents (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      UUID NOT NULL,
  client_id       UUID,                        -- clients.clients(id), без FK (см. выше)
  phone           CITEXT NOT NULL,             -- нормализованный, как в clients.phone
  full_name       TEXT,
  source          TEXT NOT NULL
                  CHECK (source IN ('public_booking', 'public_widget', 'promo', 'admin')),
  policy_version  TEXT NOT NULL,               -- редакция политики на момент согласия
  ip              INET,
  user_agent      TEXT,
  given_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at      TIMESTAMPTZ                  -- отзыв согласия; given_at при этом сохраняется
);

-- «Покажи согласия этого клиента» — карточка клиента и выгрузка по запросу субъекта.
CREATE INDEX IF NOT EXISTS idx_pd_consents_client
  ON pd_consents (company_id, client_id) WHERE client_id IS NOT NULL;
-- Тот же вопрос, когда карточки нет: ищем по номеру.
CREATE INDEX IF NOT EXISTS idx_pd_consents_phone
  ON pd_consents (company_id, phone);

COMMENT ON TABLE pd_consents IS
  'Факты согласия на обработку ПД (152-ФЗ): когда, откуда, на какую редакцию политики.';
COMMENT ON COLUMN pd_consents.policy_version IS
  'Значение PD_POLICY_VERSION из booking-service на момент согласия.';

-- Денормализованная дата последнего согласия для списка клиентов.
-- NULL у всех, кто заведён до этой миграции: согласие у них могло быть взято
-- на бумаге, но в системе следа нет — и честнее показывать пустоту, чем
-- проставить NOW() и сделать вид, что доказательство есть.
ALTER TABLE clients.clients
  ADD COLUMN IF NOT EXISTS pd_consent_at TIMESTAMPTZ;

COMMENT ON COLUMN clients.clients.pd_consent_at IS
  'Дата последнего согласия на обработку ПД. Полная история — clients.pd_consents.';
