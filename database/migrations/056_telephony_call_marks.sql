-- 056_telephony_call_marks.sql
-- Отметки администратора по звонку: кто звонил и «обработано».
--
-- Отдельная таблица, а не колонки в calls: карточка входящего живёт, пока
-- звонок ещё идёт, а строка в calls появляется только после отбоя и
-- синхронизации журнала (через ~12 с). Отметку ставят раньше, чем звонок
-- попадает в журнал, — ей нужен свой ключ, не зависящий от sync.
--
-- «Обработано» гасит карточку у всех администраторов и не даёт ей всплыть
-- снова при переподключении потока (сервер повторяет идущие звонки новому
-- соединению — см. events.activeCalls). Отметка «сотрудник» запоминается за
-- номером: в следующий раз карточка сразу подпишет «Сотрудник» и не предложит
-- завести клиента.
--
-- См. [[concepts/telephony-vats-integration]].

SET search_path TO telephony, public;

CREATE TABLE IF NOT EXISTS call_marks (
  call_id        UUID PRIMARY KEY,          -- telephony.calls(id), без FK: строки в calls может ещё не быть
  company_id     UUID NOT NULL,
  client_digits  TEXT,                      -- последние 10 цифр — чтобы помнить «сотрудник» за номером
  caller_kind    TEXT CHECK (caller_kind IN ('client', 'staff')),
  processed_at   TIMESTAMPTZ,
  processed_by   UUID,                      -- users.users(id)
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_call_marks_digits
  ON call_marks(company_id, client_digits, updated_at DESC) WHERE caller_kind IS NOT NULL;
