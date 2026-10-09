-- 064_ai_reply_templates.sql
--
-- Шаблоны ответов ИИ-ассистента и журнал его решений.
--
-- Главное архитектурное решение: текст ответа НЕ генерируется моделью.
-- Модель (Jev) отвечает только на вопрос «какая это тема», а текст берётся
-- отсюда дословно. Для клиники косметологии это не осторожность, а
-- требование: выдуманная цена или намёк на показания к процедуре стоят
-- дороже любой задержки. Генератора текста в системе нет вовсе, поэтому
-- бот физически не может выйти за одобренные формулировки.
--
-- Схема общая (ai), а не instagram: те же шаблоны понадобятся WhatsApp, и
-- заводить вторую копию значило бы править тексты в двух местах.

CREATE SCHEMA IF NOT EXISTS ai;

SET search_path TO ai, public;

-- Обновление updated_at. Своя функция в схеме ai: тянуть salons.set_updated_at
-- значило бы связать несвязанные части, а триггер нужен ровно такой же.
CREATE OR REPLACE FUNCTION ai.set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ===== Шаблоны =====
CREATE TABLE IF NOT EXISTS reply_templates (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id   UUID        NOT NULL,
  -- Ключ темы (greeting, price, hours...). Латиницей: он уходит в запрос
  -- к классификатору как идентификатор варианта и попадает в журнал.
  topic        TEXT        NOT NULL,
  -- Человеческое название темы для интерфейса.
  title        TEXT        NOT NULL,
  -- Описание для классификатора: по нему модель решает, подходит ли тема.
  -- Это самое важное поле качества — именно его читает модель, а не title.
  -- Хорошее описание говорит, что ВХОДИТ в тему, что НЕ входит, и даёт пример.
  matcher      TEXT        NOT NULL,
  -- Текст ответа. Поддерживает подстановку {name} — имя клиента, если диалог
  -- связан с карточкой. Больше никаких вычислений: всё остальное пишется
  -- буквально, иначе теряется смысл «не выходить за шаблон».
  body         TEXT        NOT NULL,
  -- Отправлять без человека. Умолчание FALSE осознанно: безопасная тема —
  -- это решение владельца по каждому шаблону отдельно, а не свойство,
  -- которое включается само при создании.
  autosend     BOOLEAN     NOT NULL DEFAULT FALSE,
  -- Выключенный шаблон не участвует ни в классификации, ни в ответах.
  -- Удаление здесь хуже: оно теряет формулировку, которую долго правили.
  enabled      BOOLEAN     NOT NULL DEFAULT TRUE,
  -- Порядок в интерфейсе. На классификацию не влияет.
  sort_order   INT         NOT NULL DEFAULT 100,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, topic)
);

CREATE INDEX IF NOT EXISTS idx_ai_templates_company
  ON reply_templates(company_id, sort_order, title);

DROP TRIGGER IF EXISTS trg_ai_templates_upd ON reply_templates;
CREATE TRIGGER trg_ai_templates_upd BEFORE UPDATE ON reply_templates
  FOR EACH ROW EXECUTE FUNCTION ai.set_updated_at();

-- ===== Журнал решений =====
--
-- Зачем хранить: без него нельзя ответить на вопрос «почему бот ответил
-- так». Вероятность и выбранная тема объясняют поведение задним числом, а
-- накопленные записи показывают, какие темы классифицируются плохо и какие
-- описания надо править. Это и есть материал для улучшения шаблонов.
CREATE TABLE IF NOT EXISTS reply_log (
  id            BIGSERIAL PRIMARY KEY,
  company_id    UUID        NOT NULL,
  channel       TEXT        NOT NULL DEFAULT 'instagram',
  thread_id     TEXT,
  -- Входящее сообщение как есть: по нему потом видно, на чём модель ошиблась.
  incoming      TEXT        NOT NULL,
  -- Что решил классификатор. NULL — тема не определена (ушло человеку).
  topic         TEXT,
  template_id   UUID        REFERENCES reply_templates(id) ON DELETE SET NULL,
  -- Калиброванная вероятность выбранной темы, 0..1.
  confidence    NUMERIC(4,3),
  -- sent — отправлено автоматически; draft — положено черновиком;
  -- skipped — решили не отвечать (спам); failed — сбой классификации.
  action        TEXT        NOT NULL,
  -- Текст, который в итоге ушёл или лёг черновиком.
  reply         TEXT,
  -- Причина, по которой не отправили сами: низкая уверенность, тема не
  -- для автоответа, ошибка. Показывается администратору в очереди.
  reason        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_log_recent
  ON reply_log(company_id, created_at DESC);

-- Разбор «какие темы работают плохо»: выборка по теме и уверенности.
CREATE INDEX IF NOT EXISTS idx_ai_log_topic
  ON reply_log(company_id, topic, created_at DESC);

COMMENT ON TABLE reply_templates IS
  'Шаблоны ответов. Текст берётся отсюда дословно: модель выбирает тему, но не пишет текст.';
COMMENT ON COLUMN reply_templates.matcher IS
  'Описание темы для классификатора. Определяет качество распознавания — важнее, чем title.';
COMMENT ON TABLE reply_log IS
  'Журнал решений ассистента: что пришло, какая тема, с какой уверенностью, что ответили.';
