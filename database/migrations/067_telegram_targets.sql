-- Уведомления в Telegram о диалогах, требующих ответа менеджера.
--
-- Группа у клиники одна, а каналов два (Instagram и WhatsApp), поэтому
-- адресат описан парой «чат + тема»: в супергруппе с включёнными темами
-- message_thread_id направляет сообщение в нужную ветку. Без темы
-- уведомления обоих каналов валятся в общую ленту и перемешиваются с
-- перепиской сотрудников.
--
-- Токен бота лежит в salons.integration_credentials (provider='telegram'),
-- как и токен Instagram: таблица уже закрыта от обычных сотрудников, а
-- наружу отдаются только последние символы.
CREATE TABLE IF NOT EXISTS ai.telegram_targets (
  company_id  uuid NOT NULL,
  channel     text NOT NULL,              -- instagram | whatsapp
  chat_id     text,                       -- id группы, вида -1001234567890
  thread_id   integer,                    -- id темы внутри группы, NULL = общая лента
  enabled     boolean NOT NULL DEFAULT true,
  updated_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, channel),
  CONSTRAINT telegram_targets_channel_chk CHECK (channel IN ('instagram', 'whatsapp'))
);

COMMENT ON COLUMN ai.telegram_targets.thread_id IS
  'message_thread_id темы супергруппы; NULL — писать в общую ленту';

-- Две строки создаются сразу выключенными: пока владелец не указал группу,
-- слать некуда, а наличие строк упрощает интерфейс — он правит, а не создаёт.
INSERT INTO ai.telegram_targets (company_id, channel, enabled)
SELECT c.company_id, ch.v, false
  FROM salons.company_profile c
 CROSS JOIN (VALUES ('instagram'), ('whatsapp')) AS ch(v)
ON CONFLICT (company_id, channel) DO NOTHING;
