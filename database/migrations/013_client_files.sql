-- 013_client_files.sql
-- Файлы (анализы, документы) прикреплённые к клиенту.
-- Хранятся в БД как bytea — приемлемо для малого салона (< 10MB на файл).
-- upload_token — уникальный токен для страницы самозагрузки клиента.

SET search_path TO clients, public;

ALTER TABLE clients ADD COLUMN IF NOT EXISTS upload_token UUID DEFAULT gen_random_uuid();
UPDATE clients SET upload_token = gen_random_uuid() WHERE upload_token IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_upload_token ON clients(upload_token) WHERE upload_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS client_files (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id   UUID NOT NULL,
  client_id    UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  file_name    TEXT NOT NULL,
  mime_type    TEXT NOT NULL,
  file_size    INT  NOT NULL,
  file_data    BYTEA NOT NULL,
  uploaded_by  TEXT NOT NULL DEFAULT 'client',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_files_client
  ON client_files(client_id, company_id);
