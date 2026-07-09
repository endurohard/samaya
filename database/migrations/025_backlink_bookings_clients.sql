-- 025_backlink_bookings_clients.sql
-- Одноразовый backfill: привязать существующие записи (bookings.client_id IS NULL)
-- к карточкам клиентов по нормализованному телефону; недостающие карточки создать.
-- Дальше booking-service сам ставит client_id при создании записи (find-or-create
-- по телефону), поэтому это нужно только для записей, созданных до фикса.
--
-- Нормализация телефона повторяет client-service/booking-service:
--   ведущий '+' сохраняется, остальные не-цифры удаляются.

DO $$
DECLARE
  r    RECORD;
  norm TEXT;
  cid  UUID;
BEGIN
  FOR r IN
    SELECT id, company_id, client_phone, client_name
    FROM bookings.bookings
    WHERE client_id IS NULL
      AND client_phone IS NOT NULL
      AND btrim(client_phone) <> ''
  LOOP
    norm := CASE
      WHEN left(btrim(r.client_phone), 1) = '+'
        THEN '+' || regexp_replace(r.client_phone, '\D', '', 'g')
      ELSE regexp_replace(r.client_phone, '\D', '', 'g')
    END;
    CONTINUE WHEN norm = '' OR norm = '+';

    INSERT INTO clients.clients (company_id, phone, full_name, source)
      VALUES (r.company_id, norm, COALESCE(NULLIF(btrim(r.client_name), ''), 'Клиент'), 'admin')
    ON CONFLICT (company_id, phone) DO NOTHING;

    SELECT id INTO cid
    FROM clients.clients
    WHERE company_id = r.company_id AND phone = norm
    LIMIT 1;

    UPDATE bookings.bookings SET client_id = cid WHERE id = r.id;
  END LOOP;
END $$;
