-- 004_inventory.sql — Phase 0b
-- Расходники, склады, поставщики, FIFO-партии, движения, техкарты услуг.
-- Идемпотентность списания через UNIQUE (source_type, source_id, product_id, lot_id).

SET search_path TO inventory, public;

-- Расходники (gel, иглы, простыни и т.п.)
CREATE TABLE IF NOT EXISTS products (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id    UUID NOT NULL,
  name          TEXT NOT NULL,
  unit          TEXT NOT NULL DEFAULT 'шт',  -- шт/мл/гр/уп/м
  category      TEXT,
  min_stock     NUMERIC(12, 3) NOT NULL DEFAULT 0,
  is_consumable BOOLEAN NOT NULL DEFAULT TRUE,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, name)
);
CREATE INDEX IF NOT EXISTS idx_products_company ON products(company_id);

-- Склады (для MVP samaya — один основной)
CREATE TABLE IF NOT EXISTS warehouses (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  UUID NOT NULL,
  name        TEXT NOT NULL,
  is_default  BOOLEAN NOT NULL DEFAULT FALSE,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, name)
);
-- Только один склад может быть default в компании
CREATE UNIQUE INDEX IF NOT EXISTS idx_warehouses_one_default
  ON warehouses(company_id) WHERE is_default = TRUE;

-- Контрагенты-поставщики (Чистовье, аптеки и т.п.)
CREATE TABLE IF NOT EXISTS suppliers (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  UUID NOT NULL,
  name        TEXT NOT NULL,
  inn         TEXT,
  phone       TEXT,
  notes       TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, name)
);

-- Накладная поставщика (логически — что и сколько пришло одной поставкой)
CREATE TABLE IF NOT EXISTS supplier_invoices (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      UUID NOT NULL,
  supplier_id     UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  warehouse_id    UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  invoice_number  TEXT,
  invoice_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  total_amount    NUMERIC(12, 2) NOT NULL DEFAULT 0,
  notes           TEXT,
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_invoices_company_date ON supplier_invoices(company_id, invoice_date DESC);

-- Партии расходников. FIFO/FEFO — списание по received_at либо expires_at.
CREATE TABLE IF NOT EXISTS stock_lots (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id         UUID NOT NULL,
  product_id         UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  warehouse_id       UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  supplier_id        UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  source_invoice_id  UUID REFERENCES supplier_invoices(id) ON DELETE SET NULL,
  qty_received       NUMERIC(12, 3) NOT NULL CHECK (qty_received > 0),
  qty_remaining      NUMERIC(12, 3) NOT NULL,
  unit_cost          NUMERIC(12, 2) NOT NULL DEFAULT 0,
  received_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at         DATE,
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (qty_remaining >= 0),
  CHECK (qty_remaining <= qty_received)
);
CREATE INDEX IF NOT EXISTS idx_lots_fifo
  ON stock_lots(company_id, product_id, warehouse_id, received_at)
  WHERE qty_remaining > 0;
CREATE INDEX IF NOT EXISTS idx_lots_fefo
  ON stock_lots(company_id, product_id, warehouse_id, expires_at)
  WHERE qty_remaining > 0 AND expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lots_invoice ON stock_lots(source_invoice_id);

-- Журнал движений: receipt (+), consumption (-), adjustment (±), writeoff (-), transfer.
CREATE TABLE IF NOT EXISTS stock_movements (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id    UUID NOT NULL,
  product_id    UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  lot_id        UUID REFERENCES stock_lots(id) ON DELETE SET NULL,
  warehouse_id  UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
  movement_type TEXT NOT NULL
                CHECK (movement_type IN ('receipt', 'consumption', 'adjustment', 'writeoff', 'transfer')),
  qty           NUMERIC(12, 3) NOT NULL,    -- + приход, - расход
  unit_cost     NUMERIC(12, 2),
  source_type   TEXT,                        -- 'booking' | 'supplier_invoice' | 'manual' | 'count'
  source_id     UUID,
  created_by    UUID,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_movements_product
  ON stock_movements(company_id, product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_movements_company_date
  ON stock_movements(company_id, created_at DESC);
-- Идемпотентность: одна и та же операция-источник не должна списать дважды.
-- Используется worker'ом outbox-консьюмером: при повторе события выловится 23505.
CREATE UNIQUE INDEX IF NOT EXISTS idx_movements_idempotency
  ON stock_movements(company_id, source_type, source_id, product_id, lot_id)
  WHERE source_type IS NOT NULL AND source_id IS NOT NULL;

-- Техкарты услуг (BOM). Версионируемые: при изменении создаётся новая активная.
CREATE TABLE IF NOT EXISTS tech_cards (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id   UUID NOT NULL,
  service_id   UUID NOT NULL,           -- ref salons.services (без FK, schema-per-service)
  version      INT NOT NULL DEFAULT 1,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, service_id, version)
);
-- В каждый момент только одна активная версия per (company, service)
CREATE UNIQUE INDEX IF NOT EXISTS idx_tech_cards_one_active
  ON tech_cards(company_id, service_id) WHERE is_active = TRUE;

CREATE TABLE IF NOT EXISTS tech_card_items (
  tech_card_id      UUID NOT NULL REFERENCES tech_cards(id) ON DELETE CASCADE,
  product_id        UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  qty_per_service   NUMERIC(12, 3) NOT NULL CHECK (qty_per_service > 0),
  PRIMARY KEY (tech_card_id, product_id)
);

-- Триггер updated_at
CREATE OR REPLACE FUNCTION inventory.set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['products','warehouses','suppliers','tech_cards']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_upd ON inventory.%I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_upd BEFORE UPDATE ON inventory.%I FOR EACH ROW EXECUTE FUNCTION inventory.set_updated_at()', t, t);
  END LOOP;
END $$;

-- Сид: дефолтный склад для компании Самая
INSERT INTO warehouses (id, company_id, name, is_default)
VALUES ('11111111-1111-1111-1111-111111111111',
        '00000000-0000-0000-0000-000000000001',
        'Основной склад', TRUE)
ON CONFLICT DO NOTHING;
