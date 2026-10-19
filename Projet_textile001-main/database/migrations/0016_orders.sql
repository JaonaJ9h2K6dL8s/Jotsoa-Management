-- Étape 16 : module Commandes clients (internes/externes).
-- Ce module alimente le workflow automatisé des lots de coupe.
-- Aucune donnée existante n'est supprimée ni modifiée.

CREATE TABLE IF NOT EXISTS clients (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  nom         TEXT    NOT NULL,
  type        TEXT    NOT NULL DEFAULT 'externe'
                CHECK (type IN ('interne','externe')),
  contact     TEXT,
  telephone   TEXT,
  email       TEXT,
  adresse     TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_clients_nom ON clients(nom);
CREATE INDEX IF NOT EXISTS idx_clients_type ON clients(type);

CREATE TABLE IF NOT EXISTS orders (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT    NOT NULL UNIQUE,
  type        TEXT    NOT NULL
                CHECK (type IN ('interne','externe')),
  client_id   INTEGER REFERENCES clients(id),
  client_nom  TEXT,
  product_id  INTEGER NOT NULL REFERENCES products(id),
  color_id    INTEGER REFERENCES colors(id),
  status      TEXT    NOT NULL DEFAULT 'a_couper'
                CHECK (status IN ('brouillon','a_couper','en_coupe','coupé','transféré','livré','annulé')),
  notes       TEXT,
  created_by  INTEGER NOT NULL REFERENCES users(id),
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_code ON orders(code);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_product ON orders(product_id);
CREATE INDEX IF NOT EXISTS idx_orders_client ON orders(client_id);

CREATE TABLE IF NOT EXISTS order_lines (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  size_id     INTEGER NOT NULL REFERENCES sizes(id),
  qty         INTEGER NOT NULL CHECK (qty > 0),
  cut_qty     INTEGER NOT NULL DEFAULT 0 CHECK (cut_qty >= 0),
  UNIQUE (order_id, size_id)
);

CREATE INDEX IF NOT EXISTS idx_order_lines_order ON order_lines(order_id);
CREATE INDEX IF NOT EXISTS idx_order_lines_size ON order_lines(size_id);

-- Trigger de mise à jour automatique de updated_at.
CREATE TRIGGER IF NOT EXISTS trg_orders_updated_at
AFTER UPDATE ON orders
BEGIN
  UPDATE orders SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_clients_updated_at
AFTER UPDATE ON clients
BEGIN
  UPDATE clients SET updated_at = datetime('now') WHERE id = NEW.id;
END;
