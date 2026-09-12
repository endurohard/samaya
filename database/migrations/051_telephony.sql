-- 051_telephony.sql
--
-- Телефония: зеркало журнала звонков из ВАТС (pbx-portal поверх FusionPBX).
--
-- Журнал зеркалим, а не проксируем на каждый показ: отчёты по сменам — это
-- группировки за месяц, гонять их через чужой API медленно и хрупко, а список
-- звонков должен открываться и когда ВАТС недоступна.
--
-- Первичный ключ звонка — uuid из ВАТС: синхронизация делает upsert по нему и
-- поэтому идемпотентна, сколько бы раз период ни перечитывали.
--
-- См. [[concepts/telephony-vats-integration]].

CREATE SCHEMA IF NOT EXISTS telephony;
SET search_path TO telephony, public;

-- Телефоны в базе клиентов лежат как придётся: 8XXXXXXXXXX, 7XXXXXXXXXX, с
-- пробелами и скобками. ВАТС отдаёт +7XXXXXXXXXX. Сравниваем по последним
-- десяти цифрам — единственная форма, в которой сходятся все варианты.
CREATE OR REPLACE FUNCTION telephony.phone_digits(p TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(RIGHT(REGEXP_REPLACE(COALESCE(p, ''), '\D', '', 'g'), 10), '')
$$;

-- ===== Внутренние номера ↔ сотрудники =====
-- Строка заводится на каждый номер из ВАТС, даже непривязанный: в интерфейсе
-- нужен полный список номеров, иначе непонятно, что ещё осталось привязать.
CREATE TABLE IF NOT EXISTS extension_links (
  company_id   UUID NOT NULL,
  extension    TEXT NOT NULL,
  master_id    UUID,                      -- salons.masters(id), без FK (schema-per-service)
  vats_name    TEXT,                      -- имя, отданное в ВАТС через PUT /employees
  enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, extension)
);

CREATE INDEX IF NOT EXISTS idx_ext_links_master
  ON extension_links(company_id, master_id) WHERE master_id IS NOT NULL;

-- ===== Журнал звонков =====
CREATE TABLE IF NOT EXISTS calls (
  id                UUID PRIMARY KEY,     -- xml_cdr_uuid из ВАТС
  company_id        UUID NOT NULL,
  started_at        TIMESTAMPTZ NOT NULL,
  direction         TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  client_number     TEXT,                 -- как отдала ВАТС, +7XXXXXXXXXX
  client_digits     TEXT,                 -- последние 10 цифр — по ним связи
  client_name_vats  TEXT,                 -- подпись номера на стороне ВАТС
  line              TEXT,                 -- на какую линию пришёл входящий
  extension         TEXT,                 -- внутренний номер сотрудника
  master_id         UUID,                 -- денормализовано из extension_links
  duration_sec      INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL CHECK (status IN ('answered', 'missed', 'cancelled')),
  has_recording     BOOLEAN NOT NULL DEFAULT FALSE,
  client_id         UUID,                 -- clients.clients(id), если номер узнали
  booking_id        UUID,                 -- запись, к которой привёл звонок (этап 3)
  synced_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calls_company_time ON calls(company_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_calls_master_time ON calls(company_id, master_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_calls_client_digits ON calls(company_id, client_digits);
CREATE INDEX IF NOT EXISTS idx_calls_client ON calls(company_id, client_id) WHERE client_id IS NOT NULL;
-- Пропущенные разбирают отдельным списком, их доля мала — частичный индекс.
CREATE INDEX IF NOT EXISTS idx_calls_missed ON calls(company_id, started_at DESC) WHERE status = 'missed';

-- ===== Сырые события звонков =====
-- Нужны не для красоты: в CDR ответивший на входящий не приходит (в портале он
-- берётся из cc_agent, то есть только для очереди колл-центра, а у клиники
-- входящие идут мимо неё). Кто взял трубку, видно только в потоке событий —
-- отсюда и восстанавливаем. Заодно это журнал для разбора спорных случаев.
CREATE TABLE IF NOT EXISTS call_events (
  id           UUID PRIMARY KEY,          -- id события из ВАТС: защита от повторной доставки
  company_id   UUID NOT NULL,
  call_id      UUID,                      -- uuid звонка; на момент события звонка в calls может ещё не быть
  type         TEXT NOT NULL,             -- incoming|ringing|answered|employee_ended|ended|dialing|accepted
  extension    TEXT,
  client_digits TEXT,
  occurred_at  TIMESTAMPTZ NOT NULL,
  payload      JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_call_events_call ON call_events(call_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_call_events_company_time ON call_events(company_id, occurred_at DESC);

-- ===== Состояние синхронизации =====
CREATE TABLE IF NOT EXISTS sync_state (
  company_id     UUID PRIMARY KEY,
  synced_until   TIMESTAMPTZ,             -- до какого момента журнал заведомо полон
  last_ok_at     TIMESTAMPTZ,
  last_error     TEXT,
  last_error_at  TIMESTAMPTZ,
  calls_total    INTEGER NOT NULL DEFAULT 0
);

-- ===== Кэш записей разговоров =====
-- ВАТС генерирует mp3 на лету через ffmpeg и отдаёт chunked — без Content-Length
-- и без Range. Браузер в таких условиях не умеет перематывать, поэтому файл
-- забираем целиком к себе и отдаём уже с Range. Побочно уходит повторная
-- перекодировка на каждое прослушивание.
CREATE TABLE IF NOT EXISTS recording_cache (
  call_id         UUID PRIMARY KEY,
  company_id      UUID NOT NULL,
  bytes           BIGINT NOT NULL,
  cached_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_played_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_rec_cache_age ON recording_cache(cached_at);

-- ===== Кто слушал разговоры =====
-- Запись разговора с пациентом — персональные данные и врачебная тайна.
-- Доступ к ней должен быть объясним постфактум, поэтому каждое прослушивание
-- оставляет след.
CREATE TABLE IF NOT EXISTS listen_log (
  id           BIGSERIAL PRIMARY KEY,
  company_id   UUID NOT NULL,
  call_id      UUID NOT NULL,
  user_id      UUID,
  user_role    TEXT,
  listened_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_listen_log_call ON listen_log(call_id, listened_at DESC);
CREATE INDEX IF NOT EXISTS idx_listen_log_user ON listen_log(company_id, user_id, listened_at DESC);
