-- Postgres init script. Запускается при первой инициализации тома postgres_data.
-- Создаёт схемы по сервисам (один Postgres, schema-per-service — см. ADR-001).

CREATE SCHEMA IF NOT EXISTS users;
CREATE SCHEMA IF NOT EXISTS salons;
CREATE SCHEMA IF NOT EXISTS bookings;
CREATE SCHEMA IF NOT EXISTS clients;
CREATE SCHEMA IF NOT EXISTS inventory;
CREATE SCHEMA IF NOT EXISTS finance;
CREATE SCHEMA IF NOT EXISTS salary;

-- Расширения, нужные всем сервисам
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "citext";
