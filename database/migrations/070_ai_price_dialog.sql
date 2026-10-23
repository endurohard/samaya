-- Состояние разговора о цене: что клиент уже сообщил.
--
-- Зачем таблица, а не разбор истории на каждое сообщение: ответы приходят
-- по одному («Москва», потом «80», потом «живот»), и каждое следующее
-- сообщение само по себе не содержит контекста. Без накопленного состояния
-- ассистент снова и снова задавал бы все три вопроса.
--
-- Ключ — канал плюс идентификатор диалога: один и тот же человек может
-- писать и в Instagram, и в WhatsApp, это разные разговоры.
CREATE TABLE IF NOT EXISTS ai.price_dialog (
  company_id  uuid        NOT NULL,
  channel     text        NOT NULL,
  thread_id   text        NOT NULL,
  city        text        NULL,
  weight      numeric(5,1) NULL,
  -- Зоны копим списком: клиент может назвать их в разных сообщениях.
  zones       text[]      NOT NULL DEFAULT '{}',
  armpits     boolean     NOT NULL DEFAULT false,
  pubis_belly boolean     NOT NULL DEFAULT false,
  -- Цена уже отправлена: защита от повторной отправки того же расчёта,
  -- если клиент напишет «спасибо» или уточнит что-то рядом.
  quoted_at   timestamptz NULL,
  asked_at    timestamptz NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, channel, thread_id)
);

-- Разговор живёт не вечно: через сутки молчания клиент, вернувшийся с
-- вопросом «а сколько стоит?», должен получить вопросы заново, а не ответ
-- по весу, названному неделю назад.
CREATE INDEX IF NOT EXISTS price_dialog_updated_idx
  ON ai.price_dialog (updated_at);
