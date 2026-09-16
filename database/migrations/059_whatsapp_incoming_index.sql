-- 059_whatsapp_incoming_index.sql
-- Индекс под опрос новых входящих для всплывающих уведомлений.
--
-- Запрос идёт из браузера каждого открытого рабочего места раз в несколько
-- секунд: WHERE company_id = ? AND from_me = false AND created_at > ?.
-- Без индекса это последовательный перебор всей переписки, и он будет
-- дорожать с каждым месяцем накопленной истории.
--
-- Частичный (from_me = false) — исходящие в этом запросе не участвуют
-- никогда, и держать их в индексе незачем.

CREATE INDEX IF NOT EXISTS idx_wa_messages_incoming
  ON whatsapp.messages (company_id, created_at DESC)
  WHERE from_me = false;
