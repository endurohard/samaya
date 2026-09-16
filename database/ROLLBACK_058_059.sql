-- Откат миграций 058 и 059 (переписка WhatsApp).
--
-- Когда нужен: выкат прошёл, но whatsapp-сервис ведёт себя плохо и решено
-- вернуть базу к состоянию до обновления. Схема whatsapp самостоятельна —
-- ни одна прежняя таблица на неё не ссылается, поэтому удаление не затрагивает
-- клиентов, записи и финансы.
--
-- ВАЖНО: вместе со схемой теряется вся сохранённая переписка. Если она нужна —
-- сначала снимите дамп только этой схемы:
--   docker exec samaya-postgres pg_dump -U samaya -d samaya -n whatsapp -Fc > wa.dump
--
-- Проверено на копии прод-базы (7454 клиента): после отката данные целы.
--
-- Запуск:
--   docker exec -i samaya-postgres psql -U samaya -d samaya -v ON_ERROR_STOP=1 -f /tmp/rollback.sql

BEGIN;

DROP TABLE IF EXISTS whatsapp.messages CASCADE;
DROP SCHEMA IF EXISTS whatsapp CASCADE;

DELETE FROM schema_migrations
 WHERE version IN ('058_whatsapp_messages.sql', '059_whatsapp_incoming_index.sql');

-- Контроль: клиентская база не должна пострадать.
SELECT 'клиентов после отката: ' || count(*) FROM clients.clients;

COMMIT;

-- Мед.карта (057) намеренно НЕ откатывается: колонки taken_at / title /
-- doctor_note уже применены на проде 15.09 и могут содержать заключения врача.
-- Их удаление — потеря медицинских данных, а не откат обновления.
