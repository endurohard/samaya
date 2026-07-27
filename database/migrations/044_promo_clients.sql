-- 044_promo_clients.sql
--
-- «Отдельно собирать новых акционных клиентов»: оставивший телефон на
-- странице акции/купона получает карточку клиента с source='promo' —
-- в разделе «Клиенты» они видны отдельным сегментом «Акционные».
-- Купон ссылается на карточку (client_id) для сквозной истории.

ALTER TABLE clients.clients DROP CONSTRAINT IF EXISTS clients_source_check;
ALTER TABLE clients.clients ADD CONSTRAINT clients_source_check
  CHECK (source IN ('admin', 'public_widget', 'import', 'master', 'promo'));

ALTER TABLE bookings.promo_coupons
  ADD COLUMN IF NOT EXISTS client_id UUID;   -- clients.clients(id), без FK (schema-per-service)
