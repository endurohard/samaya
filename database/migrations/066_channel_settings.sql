-- Режим обкатки Instagram: отвечать только перечисленным аккаунтам.
--
-- Хранится в БД, а не в переменных окружения: включать и выключать режим
-- должен владелец из админки, а правка .env требует доступа к серверу и
-- перезапуска контейнера.
CREATE TABLE IF NOT EXISTS ai.channel_settings (
  company_id   uuid        NOT NULL,
  channel      text        NOT NULL,
  -- true — реагировать только на аккаунты из test_users.
  test_mode    boolean     NOT NULL DEFAULT false,
  -- Ники без @, по одному в элементе массива.
  test_users   text[]      NOT NULL DEFAULT '{}',
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid,
  PRIMARY KEY (company_id, channel)
);

COMMENT ON TABLE ai.channel_settings IS
  'Настройки канала: режим обкатки и список тестовых аккаунтов.';
COMMENT ON COLUMN ai.channel_settings.test_mode IS
  'true — ассистент отвечает только аккаунтам из test_users; остальные диалоги сохраняются без ответа.';

CREATE OR REPLACE FUNCTION ai.set_channel_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_channel_settings_upd ON ai.channel_settings;
CREATE TRIGGER trg_channel_settings_upd
  BEFORE UPDATE ON ai.channel_settings
  FOR EACH ROW EXECUTE FUNCTION ai.set_channel_updated_at();

-- Стартовая строка для Instagram: режим обкатки ВКЛЮЧЕН и список пуст.
-- Это намеренно самое безопасное состояние — пока владелец не впишет свой
-- аккаунт, ассистент не ответит никому, и настоящие клиентки не получат
-- сообщений от необкатанной системы.
INSERT INTO ai.channel_settings (company_id, channel, test_mode, test_users)
SELECT company_id, 'instagram', true, '{}'
  FROM salons.company_profile
ON CONFLICT (company_id, channel) DO NOTHING;
