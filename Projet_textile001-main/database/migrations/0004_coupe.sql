-- Étape 4 : module Coupe.
-- Tables transactionnelles de la coupe : rouleaux, lots, tâches,
-- résultats, déchets, paquets, identifiants/QR, transferts, historique.
-- Aucune donnée existante n'est supprimée ni modifiée.

CREATE TABLE IF NOT EXISTS coupe_rolls (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  code               TEXT    NOT NULL,
  fabric_ref         TEXT    NOT NULL,
  color_id           INTEGER REFERENCES colors(id),
  initial_weight_kg  REAL    NOT NULL
                     CHECK (initial_weight_kg >= 9 AND initial_weight_kg <= 30),
  initial_qty        REAL    CHECK (initial_qty IS NULL OR initial_qty >= 0),
  qty_unit           TEXT,
  remaining_weight_kg REAL,
  remaining_qty      REAL    CHECK (remaining_qty IS NULL OR remaining_qty >= 0),
  supplier           TEXT,
  status             TEXT    NOT NULL DEFAULT 'disponible'
                     CHECK (status IN ('disponible','en_utilisation','epuise','bloque','defectueux')),
  observations       TEXT,
  received_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_coupe_rolls_code ON coupe_rolls(code);
CREATE INDEX IF NOT EXISTS idx_coupe_rolls_status ON coupe_rolls(status);
CREATE INDEX IF NOT EXISTS idx_coupe_rolls_color ON coupe_rolls(color_id);

CREATE TABLE IF NOT EXISTS coupe_lots (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  code              TEXT    NOT NULL,
  product_id        INTEGER NOT NULL REFERENCES products(id),
  color_id          INTEGER NOT NULL REFERENCES colors(id),
  total_planned_qty REAL    NOT NULL DEFAULT 0 CHECK (total_planned_qty >= 0),
  status            TEXT    NOT NULL DEFAULT 'brouillon'
                    CHECK (status IN ('brouillon','en_cours','attente_validation','bloque','pret_transfert','transfere','annule')),
  responsable_id    INTEGER NOT NULL REFERENCES users(id),
  notes             TEXT,
  started_at        TEXT,
  finished_at       TEXT,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_coupe_lots_code ON coupe_lots(code);
CREATE INDEX IF NOT EXISTS idx_coupe_lots_status ON coupe_lots(status);
CREATE INDEX IF NOT EXISTS idx_coupe_lots_product ON coupe_lots(product_id);

CREATE TABLE IF NOT EXISTS coupe_lot_sizes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  lot_id      INTEGER NOT NULL REFERENCES coupe_lots(id),
  size_id     INTEGER NOT NULL REFERENCES sizes(id),
  planned_qty REAL    NOT NULL CHECK (planned_qty > 0),
  UNIQUE (lot_id, size_id)
);

CREATE INDEX IF NOT EXISTS idx_coupe_lot_sizes_lot ON coupe_lot_sizes(lot_id);

CREATE TABLE IF NOT EXISTS coupe_tasks (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  lot_id            INTEGER NOT NULL REFERENCES coupe_lots(id),
  code              TEXT    NOT NULL,
  description       TEXT    NOT NULL,
  is_mandatory      INTEGER NOT NULL DEFAULT 1 CHECK (is_mandatory IN (0,1)),
  requires_results  INTEGER NOT NULL DEFAULT 1 CHECK (requires_results IN (0,1)),
  status            TEXT    NOT NULL DEFAULT 'a_faire'
                    CHECK (status IN ('a_faire','en_cours','en_attente','terminee','a_verifier','validee','bloquee','annulee')),
  responsable_id    INTEGER NOT NULL REFERENCES users(id),
  observations      TEXT,
  started_at        TEXT,
  finished_at       TEXT,
  validated_by      INTEGER REFERENCES users(id),
  validated_at      TEXT,
  validation_notes  TEXT,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_coupe_tasks_code ON coupe_tasks(code);
CREATE INDEX IF NOT EXISTS idx_coupe_tasks_lot ON coupe_tasks(lot_id);
CREATE INDEX IF NOT EXISTS idx_coupe_tasks_status ON coupe_tasks(status);

CREATE TABLE IF NOT EXISTS coupe_task_rolls (
  task_id     INTEGER NOT NULL REFERENCES coupe_tasks(id),
  roll_id     INTEGER NOT NULL REFERENCES coupe_rolls(id),
  weight_used REAL,
  PRIMARY KEY (task_id, roll_id)
);

CREATE INDEX IF NOT EXISTS idx_coupe_task_rolls_roll ON coupe_task_rolls(roll_id);

CREATE TABLE IF NOT EXISTS coupe_results (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id      INTEGER NOT NULL REFERENCES coupe_tasks(id),
  lot_id       INTEGER NOT NULL REFERENCES coupe_lots(id),
  size_id      INTEGER NOT NULL REFERENCES sizes(id),
  planned_qty  REAL    NOT NULL DEFAULT 0 CHECK (planned_qty >= 0),
  cut_qty      REAL    NOT NULL DEFAULT 0 CHECK (cut_qty >= 0),
  usable_qty   REAL    NOT NULL DEFAULT 0 CHECK (usable_qty >= 0),
  anomaly_qty  REAL    NOT NULL DEFAULT 0 CHECK (anomaly_qty >= 0),
  waste_qty    REAL    NOT NULL DEFAULT 0 CHECK (waste_qty >= 0),
  created_by   INTEGER NOT NULL REFERENCES users(id),
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (task_id, size_id),
  CHECK (usable_qty + anomaly_qty <= cut_qty)
);

CREATE INDEX IF NOT EXISTS idx_coupe_results_lot ON coupe_results(lot_id);
CREATE INDEX IF NOT EXISTS idx_coupe_results_size ON coupe_results(size_id);

CREATE TABLE IF NOT EXISTS coupe_roll_movements (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  roll_id       INTEGER NOT NULL REFERENCES coupe_rolls(id),
  movement_type TEXT   NOT NULL
                CHECK (movement_type IN ('creation','affectation','consommation','correction_poids','blocage','deblocage','statut')),
  lot_id        INTEGER REFERENCES coupe_lots(id),
  task_id       INTEGER REFERENCES coupe_tasks(id),
  weight_before REAL,
  weight_after  REAL,
  qty           REAL,
  unit          TEXT,
  reason        TEXT,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_coupe_mov_roll ON coupe_roll_movements(roll_id);
CREATE INDEX IF NOT EXISTS idx_coupe_mov_lot ON coupe_roll_movements(lot_id);

CREATE TABLE IF NOT EXISTS coupe_waste (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  lot_id      INTEGER REFERENCES coupe_lots(id),
  roll_id     INTEGER REFERENCES coupe_rolls(id),
  waste_type  TEXT    NOT NULL
              CHECK (waste_type IN ('chute','dechet','tissu_defectueux','autre')),
  qty         REAL    NOT NULL CHECK (qty > 0),
  unit        TEXT    NOT NULL DEFAULT 'kg',
  reason      TEXT,
  observations TEXT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_coupe_waste_lot ON coupe_waste(lot_id);
CREATE INDEX IF NOT EXISTS idx_coupe_waste_roll ON coupe_waste(roll_id);

CREATE TABLE IF NOT EXISTS coupe_bundles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  lot_id      INTEGER NOT NULL REFERENCES coupe_lots(id),
  size_id     INTEGER NOT NULL REFERENCES sizes(id),
  qty         REAL    NOT NULL CHECK (qty > 0),
  status      TEXT    NOT NULL DEFAULT 'en_cours'
              CHECK (status IN ('en_cours','pret','transfere')),
  created_by  INTEGER NOT NULL REFERENCES users(id),
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_coupe_bundles_lot ON coupe_bundles(lot_id);

CREATE TABLE IF NOT EXISTS coupe_identifiers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  object_type     TEXT    NOT NULL CHECK (object_type IN ('rouleau','lot','paquet')),
  object_id       INTEGER NOT NULL,
  code            TEXT    NOT NULL,
  qr_payload      TEXT    NOT NULL,
  reprint_count   INTEGER NOT NULL DEFAULT 0,
  last_printed_at TEXT,
  created_by      INTEGER NOT NULL REFERENCES users(id),
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (object_type, code),
  UNIQUE (object_type, object_id)
);

CREATE INDEX IF NOT EXISTS idx_coupe_identifiers_code ON coupe_identifiers(code);

CREATE TABLE IF NOT EXISTS coupe_transfers (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  lot_id       INTEGER NOT NULL UNIQUE REFERENCES coupe_lots(id),
  code         TEXT    NOT NULL UNIQUE,
  status       TEXT    NOT NULL DEFAULT 'confirme' CHECK (status IN ('confirme','annule')),
  performed_by INTEGER NOT NULL REFERENCES users(id),
  confirmed_at TEXT    NOT NULL DEFAULT (datetime('now')),
  notes        TEXT
);

CREATE TABLE IF NOT EXISTS coupe_transfer_lines (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  transfer_id  INTEGER NOT NULL REFERENCES coupe_transfers(id),
  product_id   INTEGER NOT NULL REFERENCES products(id),
  color_id     INTEGER NOT NULL REFERENCES colors(id),
  size_id      INTEGER NOT NULL REFERENCES sizes(id),
  qty          REAL    NOT NULL CHECK (qty > 0),
  UNIQUE (transfer_id, size_id)
);

CREATE INDEX IF NOT EXISTS idx_coupe_transfer_lines_transfer
  ON coupe_transfer_lines(transfer_id);

CREATE TABLE IF NOT EXISTS coupe_history (
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

CREATE INDEX IF NOT EXISTS idx_coupe_history_entity
  ON coupe_history(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_coupe_history_actor ON coupe_history(actor_id);
