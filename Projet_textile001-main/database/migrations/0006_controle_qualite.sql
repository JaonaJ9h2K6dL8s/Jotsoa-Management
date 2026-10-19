-- Étape 6 : module Contrôle qualité.
-- Migration non destructive : réceptions des transferts couture,
-- contrôles, défauts, demandes de retouche, contrôles finaux,
-- transferts vers le stock et historique. Les mécanismes transversaux
-- (alerts, sensitive_requests) sont réutilisés, pas dupliqués.

CREATE TABLE IF NOT EXISTS cq_receptions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT    NOT NULL UNIQUE,
  transfer_id INTEGER NOT NULL UNIQUE REFERENCES couture_transfers(id),
  lot_id      INTEGER NOT NULL REFERENCES coupe_lots(id),
  status      TEXT    NOT NULL DEFAULT 'complete'
              CHECK (status IN ('complete','partielle')),
  notes       TEXT,
  received_by INTEGER NOT NULL REFERENCES users(id),
  received_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cq_reception_lines (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  reception_id    INTEGER NOT NULL REFERENCES cq_receptions(id),
  size_id         INTEGER NOT NULL REFERENCES sizes(id),
  transferred_qty REAL    NOT NULL CHECK (transferred_qty >= 0),
  received_qty    REAL    NOT NULL CHECK (received_qty >= 0),
  UNIQUE (reception_id, size_id)
);

CREATE INDEX IF NOT EXISTS idx_cq_receptions_lot ON cq_receptions(lot_id);

-- Un contrôle par réception : les quantités restent cohérentes et
-- progressives sur une seule fiche.
CREATE TABLE IF NOT EXISTS cq_controles (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT    NOT NULL UNIQUE,
  reception_id  INTEGER NOT NULL UNIQUE REFERENCES cq_receptions(id),
  lot_id        INTEGER NOT NULL REFERENCES coupe_lots(id),
  product_id    INTEGER NOT NULL REFERENCES products(id),
  color_id      INTEGER NOT NULL REFERENCES colors(id),
  status        TEXT    NOT NULL DEFAULT 'en_attente'
                CHECK (status IN ('en_attente','en_cours','incomplet',
                                  'attente_validation','valide','bloque','cloture')),
  controlled_by INTEGER NOT NULL REFERENCES users(id),
  notes         TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cq_controle_lines (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  controle_id   INTEGER NOT NULL REFERENCES cq_controles(id),
  size_id       INTEGER NOT NULL REFERENCES sizes(id),
  inspected_qty REAL    NOT NULL DEFAULT 0 CHECK (inspected_qty >= 0),
  conforme_qty  REAL    NOT NULL DEFAULT 0 CHECK (conforme_qty >= 0),
  UNIQUE (controle_id, size_id)
);

CREATE INDEX IF NOT EXISTS idx_cq_controles_lot ON cq_controles(lot_id);

-- Un enregistrement par catégorie de défaut : la même pièce peut
-- accumuler plusieurs défauts sans être comptée deux fois dans les
-- quantités de pièces (qty_pieces = pièces concernées, pas défauts).
CREATE TABLE IF NOT EXISTS cq_defauts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  controle_id    INTEGER NOT NULL REFERENCES cq_controles(id),
  lot_id         INTEGER NOT NULL REFERENCES coupe_lots(id),
  size_id        INTEGER NOT NULL REFERENCES sizes(id),
  defect_id      INTEGER NOT NULL REFERENCES defects(id),
  rework_zone_id INTEGER REFERENCES rework_zones(id),
  qty_pieces     REAL    NOT NULL CHECK (qty_pieces > 0),
  description    TEXT,
  severity       TEXT    NOT NULL DEFAULT 'mineure'
                 CHECK (severity IN ('mineure','majeure','critique')),
  decision       TEXT    NOT NULL DEFAULT 'attente'
                 CHECK (decision IN ('attente','retouche','rebut')),
  declared_by    INTEGER NOT NULL REFERENCES users(id),
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cq_defauts_controle ON cq_defauts(controle_id);

CREATE TABLE IF NOT EXISTS cq_rework_requests (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  code         TEXT    NOT NULL UNIQUE,
  controle_id  INTEGER NOT NULL REFERENCES cq_controles(id),
  lot_id       INTEGER NOT NULL REFERENCES coupe_lots(id),
  origin       TEXT    NOT NULL DEFAULT 'initial'
               CHECK (origin IN ('initial','final')),
  origin_final INTEGER REFERENCES cq_final_controls(id),
  status       TEXT    NOT NULL DEFAULT 'en_attente'
               CHECK (status IN ('en_attente','acceptee','refusee','annulee')),
  reason       TEXT    NOT NULL,
  requested_by INTEGER NOT NULL REFERENCES users(id),
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cq_rework_lines (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES cq_rework_requests(id),
  size_id    INTEGER NOT NULL REFERENCES sizes(id),
  qty        REAL    NOT NULL CHECK (qty > 0),
  UNIQUE (request_id, size_id)
);

CREATE INDEX IF NOT EXISTS idx_cq_rework_requests_lot ON cq_rework_requests(lot_id);

CREATE TABLE IF NOT EXISTS cq_final_controls (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT    NOT NULL UNIQUE,
  request_id    INTEGER NOT NULL UNIQUE REFERENCES cq_rework_requests(id),
  lot_id        INTEGER NOT NULL REFERENCES coupe_lots(id),
  status        TEXT    NOT NULL DEFAULT 'en_cours'
                CHECK (status IN ('en_cours','valide','cloture')),
  controlled_by INTEGER NOT NULL REFERENCES users(id),
  notes         TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Quantités revenues de retouche et leurs décisions par taille :
-- conforme, nouvelle retouche ou rebut (attente = non décidé).
CREATE TABLE IF NOT EXISTS cq_final_lines (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  final_id     INTEGER NOT NULL REFERENCES cq_final_controls(id),
  size_id      INTEGER NOT NULL REFERENCES sizes(id),
  returned_qty REAL    NOT NULL DEFAULT 0 CHECK (returned_qty >= 0),
  conforme_qty REAL    NOT NULL DEFAULT 0 CHECK (conforme_qty >= 0),
  rework_qty   REAL    NOT NULL DEFAULT 0 CHECK (rework_qty >= 0),
  rebut_qty    REAL    NOT NULL DEFAULT 0 CHECK (rebut_qty >= 0),
  UNIQUE (final_id, size_id)
);

CREATE TABLE IF NOT EXISTS cq_stock_transfers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT    NOT NULL UNIQUE,
  controle_id INTEGER NOT NULL REFERENCES cq_controles(id),
  lot_id      INTEGER NOT NULL REFERENCES coupe_lots(id),
  status      TEXT    NOT NULL DEFAULT 'confirme'
              CHECK (status IN ('confirme','annule')),
  prepared_by INTEGER NOT NULL REFERENCES users(id),
  confirmed_at TEXT   NOT NULL DEFAULT (datetime('now')),
  notes       TEXT
);

CREATE TABLE IF NOT EXISTS cq_stock_transfer_lines (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  transfer_id INTEGER NOT NULL REFERENCES cq_stock_transfers(id),
  size_id     INTEGER NOT NULL REFERENCES sizes(id),
  qty         REAL    NOT NULL CHECK (qty > 0),
  UNIQUE (transfer_id, size_id)
);

CREATE INDEX IF NOT EXISTS idx_cq_stock_transfers_lot ON cq_stock_transfers(lot_id);

-- Historique du module Contrôle qualité (immutabilité applicative).
CREATE TABLE IF NOT EXISTS cq_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  action      TEXT    NOT NULL,
  entity_type TEXT    NOT NULL,
  entity_id   INTEGER NOT NULL,
  actor_id    INTEGER NOT NULL REFERENCES users(id),
  old_value   TEXT,
  new_value   TEXT,
  reason      TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cq_history_entity
  ON cq_history(entity_type, entity_id);
