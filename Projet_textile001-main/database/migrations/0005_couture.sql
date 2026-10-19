-- Étape 5 : module Couture + mécanismes transversaux.
-- Réceptions Coupe, affectations, productions, incidents,
-- transferts vers le Contrôle qualité, alertes et secondes validations.
-- Aucune donnée existante n'est supprimée ni modifiée.

-- Mécanisme central d'alertes (partagé entre modules).
CREATE TABLE IF NOT EXISTS alerts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  category    TEXT    NOT NULL,
  severity    TEXT    NOT NULL DEFAULT 'warning'
              CHECK (severity IN ('info','warning','critical')),
  object_type TEXT,
  object_id   INTEGER,
  message     TEXT    NOT NULL,
  owner_role  TEXT,
  status      TEXT    NOT NULL DEFAULT 'nouvelle'
              CHECK (status IN ('nouvelle','en_cours','resolue','cloturee')),
  resolution  TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status);
CREATE INDEX IF NOT EXISTS idx_alerts_object ON alerts(object_type, object_id);

-- Mécanisme central de seconde validation des opérations sensibles.
CREATE TABLE IF NOT EXISTS sensitive_requests (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  action        TEXT    NOT NULL,
  entity_type   TEXT    NOT NULL,
  entity_id     INTEGER NOT NULL,
  payload       TEXT    NOT NULL,
  reason        TEXT    NOT NULL,
  status        TEXT    NOT NULL DEFAULT 'en_attente'
                CHECK (status IN ('en_attente','approuvee','refusee','expiree')),
  requested_by  INTEGER NOT NULL REFERENCES users(id),
  requested_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  decided_by    INTEGER REFERENCES users(id),
  decided_at    TEXT,
  decision_note TEXT
);

CREATE INDEX IF NOT EXISTS idx_sensitive_status ON sensitive_requests(status);

-- Suivi des lots côté Couture (statuts contrôlés).
CREATE TABLE IF NOT EXISTS couture_lot_status (
  lot_id     INTEGER PRIMARY KEY REFERENCES coupe_lots(id),
  status     TEXT    NOT NULL DEFAULT 'en_attente_reception'
             CHECK (status IN ('en_attente_reception','reception_partielle','reception_confirmee',
                               'a_affecter','affecte','en_cours','en_pause','attente_reprise',
                               'couture_terminee','attente_transfert','transfere_cq','bloque','annule')),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS couture_receptions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  transfer_id    INTEGER NOT NULL UNIQUE REFERENCES coupe_transfers(id),
  lot_id         INTEGER NOT NULL REFERENCES coupe_lots(id),
  status         TEXT    NOT NULL CHECK (status IN ('complete','partielle')),
  notes          TEXT,
  received_by    INTEGER NOT NULL REFERENCES users(id),
  received_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS couture_reception_lines (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  reception_id    INTEGER NOT NULL REFERENCES couture_receptions(id),
  product_id      INTEGER NOT NULL REFERENCES products(id),
  color_id        INTEGER NOT NULL REFERENCES colors(id),
  size_id         INTEGER NOT NULL REFERENCES sizes(id),
  transferred_qty REAL    NOT NULL CHECK (transferred_qty >= 0),
  received_qty    REAL    NOT NULL CHECK (received_qty >= 0),
  UNIQUE (reception_id, size_id),
  CHECK (received_qty <= transferred_qty)
);

CREATE INDEX IF NOT EXISTS idx_reception_lines_size
  ON couture_reception_lines(size_id);

CREATE TABLE IF NOT EXISTS couture_assignments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  code           TEXT    NOT NULL UNIQUE,
  lot_id         INTEGER NOT NULL REFERENCES coupe_lots(id),
  room_id        INTEGER NOT NULL REFERENCES sewing_rooms(id),
  line_id        INTEGER NOT NULL REFERENCES sewing_lines(id),
  responsable_id INTEGER NOT NULL REFERENCES users(id),
  status         TEXT    NOT NULL DEFAULT 'affecte'
                 CHECK (status IN ('affecte','en_cours','en_pause','terminee','bloquee','annulee')),
  notes          TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_assignments_lot ON couture_assignments(lot_id);
CREATE INDEX IF NOT EXISTS idx_assignments_line ON couture_assignments(line_id);

CREATE TABLE IF NOT EXISTS couture_assignment_sizes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id INTEGER NOT NULL REFERENCES couture_assignments(id),
  size_id       INTEGER NOT NULL REFERENCES sizes(id),
  planned_qty   REAL    NOT NULL CHECK (planned_qty > 0),
  UNIQUE (assignment_id, size_id)
);

CREATE TABLE IF NOT EXISTS couture_productions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id INTEGER NOT NULL REFERENCES couture_assignments(id),
  lot_id        INTEGER NOT NULL REFERENCES coupe_lots(id),
  size_id       INTEGER NOT NULL REFERENCES sizes(id),
  qty           REAL    NOT NULL CHECK (qty > 0),
  operator_id   INTEGER REFERENCES users(id),
  recorded_by   INTEGER NOT NULL REFERENCES users(id),
  status        TEXT    NOT NULL DEFAULT 'normal'
                CHECK (status IN ('normal','corrigee','annulee')),
  notes         TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_productions_assignment
  ON couture_productions(assignment_id);
CREATE INDEX IF NOT EXISTS idx_productions_lot_size
  ON couture_productions(lot_id, size_id);

CREATE TABLE IF NOT EXISTS couture_incidents (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  lot_id          INTEGER REFERENCES coupe_lots(id),
  assignment_id   INTEGER REFERENCES couture_assignments(id),
  room_id         INTEGER REFERENCES sewing_rooms(id),
  line_id         INTEGER REFERENCES sewing_lines(id),
  incident_type   TEXT    NOT NULL,
  severity        TEXT    NOT NULL CHECK (severity IN ('mineure','majeure','critique')),
  status          TEXT    NOT NULL DEFAULT 'ouverte'
                  CHECK (status IN ('ouverte','en_cours','resolue','cloturee')),
  description     TEXT    NOT NULL,
  started_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  ended_at        TEXT,
  resolution_note TEXT,
  declared_by     INTEGER NOT NULL REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_incidents_status ON couture_incidents(status);

CREATE TABLE IF NOT EXISTS couture_transfers (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  code           TEXT    NOT NULL UNIQUE,
  assignment_id  INTEGER NOT NULL REFERENCES couture_assignments(id),
  lot_id         INTEGER NOT NULL REFERENCES coupe_lots(id),
  status         TEXT    NOT NULL DEFAULT 'confirme'
                 CHECK (status IN ('confirme','annule')),
  prepared_by    INTEGER NOT NULL REFERENCES users(id),
  confirmed_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  notes          TEXT
);

CREATE INDEX IF NOT EXISTS idx_couture_transfers_lot
  ON couture_transfers(lot_id);

CREATE TABLE IF NOT EXISTS couture_transfer_lines (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  transfer_id INTEGER NOT NULL REFERENCES couture_transfers(id),
  size_id     INTEGER NOT NULL REFERENCES sizes(id),
  qty         REAL    NOT NULL CHECK (qty > 0),
  UNIQUE (transfer_id, size_id)
);

CREATE TABLE IF NOT EXISTS couture_history (
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

CREATE INDEX IF NOT EXISTS idx_couture_history_entity
  ON couture_history(entity_type, entity_id);
