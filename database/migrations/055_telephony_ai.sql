-- 055_telephony_ai.sql
-- Звонки, на которые ответил AI-оператор ВАТС, и его заявки.
--
-- Заявка — то, что AI-оператор понял из разговора: кто, что хотел, на когда.
-- Первичный ключ — id заявки в ВАТС, поэтому повторная синхронизация и
-- событие ai_ticket безопасно накладываются друг на друга. Статус общий с
-- ВАТС: закрыли здесь → ушло туда и в Telegram-группу, и наоборот.

SET search_path TO telephony, public;

-- Кто реально говорил с клиентом: employee | ai | NULL (никто). В отличие от
-- extension, различает «ответил AI-оператор» и «никто не взял».
ALTER TABLE calls ADD COLUMN IF NOT EXISTS handled_by TEXT
  CHECK (handled_by IN ('employee', 'ai'));

CREATE TABLE IF NOT EXISTS ai_tickets (
  id             UUID PRIMARY KEY,          -- ticket id из ВАТС
  company_id     UUID NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL,
  kind           TEXT NOT NULL,             -- booking | order | callback | question | request
  status         TEXT NOT NULL DEFAULT 'new', -- new | confirmed | done | cancelled (общий с ВАТС)
  client_number  TEXT,                      -- +7XXXXXXXXXX
  client_digits  TEXT,                      -- последние 10 цифр — по ним связь с клиентом
  client_name    TEXT,                      -- как представился
  when_text      TEXT,                      -- «в четверг после обеда» — как сказал клиент
  service        TEXT,
  specialist     TEXT,
  comment        TEXT,
  summary        TEXT,                      -- резюме разговора от AI
  call_id        UUID,                      -- telephony.calls(id), без FK: звонок может прийти позже
  has_recording  BOOLEAN NOT NULL DEFAULT FALSE,
  client_id      UUID,                      -- clients.clients(id), если номер узнали
  handled_by     UUID,                      -- users.users(id) — кто закрыл у нас
  handled_at     TIMESTAMPTZ,
  synced_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_tickets_company_time ON ai_tickets(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_tickets_open ON ai_tickets(company_id, status) WHERE status = 'new';
CREATE INDEX IF NOT EXISTS idx_ai_tickets_client ON ai_tickets(company_id, client_id) WHERE client_id IS NOT NULL;
