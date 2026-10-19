-- Étape 8 : module Cartons et Stock.
-- Migration non destructive : emplacements, cartons, entrées depuis
-- les transferts CQ, mouvements, transferts internes, inventaires,
-- ajustements soumis à seconde validation, mouvements de déchets et
-- historique. Les alertes et les validations sensibles centrales sont
-- réutilisées, jamais dupliquées. Le stock est toujours recalculé
-- depuis les mouvements réels (jamais saisi directement).

CREATE TABLE IF NOT EXISTS st_locations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code       TEXT    NOT NULL UNIQUE,
  label      TEXT    NOT NULL,
  area       TEXT    NOT NULL DEFAULT 'emplacement'
             CHECK (area IN ('zone','salle','rangee','etagere','niveau','emplacement')),
  is_active  INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  notes      TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS st_cartons (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  code           TEXT    NOT NULL UNIQUE,
  status         TEXT    NOT NULL DEFAULT 'remplissage'
                 CHECK (status IN ('remplissage','cloture','bloque',
                                   'partiellement_sorti','vide','annule')),
  location_id    INTEGER REFERENCES st_locations(id),
  notes          TEXT,
  created_by     INTEGER NOT NULL REFERENCES users(id),
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  closed_at      TEXT,
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_st_cartons_location ON st_cartons(location_id);
CREATE INDEX IF NOT EXISTS idx_st_cartons_status ON st_cartons(status);

-- Ligne par lot + contrôle + taille : plusieurs références peuvent
-- cohabiter dans un carton sans être mélangées dans les soldes.
CREATE TABLE IF NOT EXISTS st_carton_lines (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  carton_id   INTEGER NOT NULL REFERENCES st_cartons(id),
  lot_id      INTEGER NOT NULL REFERENCES coupe_lots(id),
  controle_id INTEGER NOT NULL REFERENCES cq_controles(id),
  size_id     INTEGER NOT NULL REFERENCES sizes(id),
  qty         REAL    NOT NULL CHECK (qty > 0),
  UNIQUE (carton_id, lot_id, controle_id, size_id)
);

CREATE INDEX IF NOT EXISTS idx_st_carton_lines_carton ON st_carton_lines(carton_id);

-- Entrée d'un transfert CQ confirmé : une seule réception par transfert.
CREATE TABLE IF NOT EXISTS st_entries (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  code            TEXT    NOT NULL UNIQUE,
  transfer_id     INTEGER NOT NULL UNIQUE REFERENCES cq_stock_transfers(id),
  received_by     INTEGER NOT NULL REFERENCES users(id),
  notes           TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS st_entry_lines (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id    INTEGER NOT NULL REFERENCES st_entries(id),
  lot_id      INTEGER NOT NULL REFERENCES coupe_lots(id),
  controle_id INTEGER NOT NULL REFERENCES cq_controles(id),
  size_id     INTEGER NOT NULL REFERENCES sizes(id),
  carton_id   INTEGER NOT NULL REFERENCES st_cartons(id),
  qty         REAL    NOT NULL CHECK (qty > 0),
  UNIQUE (entry_id, carton_id, size_id)
);

-- Source de vérité du stock : chaque quantité résulte d'un mouvement.
-- ajustement/annulation portent un delta signé (jamais 0) ; les autres
-- types une quantité strictement positive. Le type « transfert » ne
-- change pas les soldes (déplacement physique d'un carton).
CREATE TABLE IF NOT EXISTS st_movements (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  movement_type     TEXT    NOT NULL
                    CHECK (movement_type IN ('entree_cq','transfert','sortie',
                                             'retour','ajustement','annulation')),
  lot_id            INTEGER NOT NULL REFERENCES coupe_lots(id),
  size_id           INTEGER NOT NULL REFERENCES sizes(id),
  qty               REAL    NOT NULL
                    CHECK (CASE WHEN movement_type IN ('ajustement','annulation')
                                THEN qty <> 0 ELSE qty > 0 END),
  carton_id         INTEGER REFERENCES st_cartons(id),
  location_from_id  INTEGER REFERENCES st_locations(id),
  location_to_id    INTEGER REFERENCES st_locations(id),
  source_type       TEXT,
  source_id         INTEGER,
  reason            TEXT,
  user_id           INTEGER NOT NULL REFERENCES users(id),
  created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_st_movements_lot_size ON st_movements(lot_id, size_id);
CREATE INDEX IF NOT EXISTS idx_st_movements_carton ON st_movements(carton_id);
CREATE INDEX IF NOT EXISTS idx_st_movements_source ON st_movements(source_type, source_id);

CREATE TABLE IF NOT EXISTS st_transfers (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  code             TEXT    NOT NULL UNIQUE,
  carton_id        INTEGER NOT NULL REFERENCES st_cartons(id),
  from_location_id INTEGER REFERENCES st_locations(id),
  to_location_id   INTEGER NOT NULL REFERENCES st_locations(id),
  reason           TEXT,
  status           TEXT    NOT NULL DEFAULT 'confirme'
                   CHECK (status IN ('confirme','annule')),
  performed_by     INTEGER NOT NULL REFERENCES users(id),
  confirmed_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_st_transfers_carton ON st_transfers(carton_id);

CREATE TABLE IF NOT EXISTS st_inventories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT    NOT NULL UNIQUE,
  location_id INTEGER REFERENCES st_locations(id),
  status      TEXT    NOT NULL DEFAULT 'comptage'
              CHECK (status IN ('comptage','ecarts','attente_validation',
                                'valide','cloture','annule')),
  notes       TEXT,
  created_by  INTEGER NOT NULL REFERENCES users(id),
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  counted_at  TEXT,
  validated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_st_inventories_location ON st_inventories(location_id);

-- Comptage physique par carton et taille : le théorique est figé à la
-- création de la ligne (instant de référence explicite).
CREATE TABLE IF NOT EXISTS st_inventory_lines (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  inventory_id    INTEGER NOT NULL REFERENCES st_inventories(id),
  carton_id       INTEGER NOT NULL REFERENCES st_cartons(id),
  lot_id          INTEGER NOT NULL REFERENCES coupe_lots(id),
  size_id         INTEGER NOT NULL REFERENCES sizes(id),
  theoretical_qty REAL    NOT NULL CHECK (theoretical_qty >= 0),
  counted_qty     REAL    CHECK (counted_qty IS NULL OR counted_qty >= 0),
  observation     TEXT,
  counted_by      INTEGER REFERENCES users(id),
  counted_at      TEXT,
  UNIQUE (inventory_id, carton_id, size_id)
);

CREATE INDEX IF NOT EXISTS idx_st_inventory_lines_inventory
  ON st_inventory_lines(inventory_id);

-- Écart soumis à seconde validation : aucun ajustement automatique.
CREATE TABLE IF NOT EXISTS st_adjustments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT    NOT NULL UNIQUE,
  inventory_id  INTEGER NOT NULL REFERENCES st_inventories(id),
  carton_id     INTEGER NOT NULL REFERENCES st_cartons(id),
  lot_id        INTEGER NOT NULL REFERENCES coupe_lots(id),
  size_id       INTEGER NOT NULL REFERENCES sizes(id),
  delta_qty     REAL    NOT NULL CHECK (delta_qty <> 0),
  reason        TEXT    NOT NULL,
  status        TEXT    NOT NULL DEFAULT 'en_attente'
                CHECK (status IN ('en_attente','approuve','refuse')),
  requested_by  INTEGER NOT NULL REFERENCES users(id),
  decided_by    INTEGER REFERENCES users(id),
  decided_at    TEXT,
  decision_note TEXT,
  movement_id   INTEGER REFERENCES st_movements(id),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_st_adjustments_status ON st_adjustments(status);

-- Déchets textiles : stock distinct des vêtements finis. Les entrées
-- restent la table coupe_waste (kg, jamais mélangés aux pièces) ; ces
-- mouvements tracent les sorties et ajustements autorisés.
CREATE TABLE IF NOT EXISTS st_waste_movements (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  waste_type    TEXT    NOT NULL
                CHECK (waste_type IN ('chute','dechet','tissu_defectueux','autre')),
  movement_type TEXT    NOT NULL
                CHECK (movement_type IN ('sortie','ajustement')),
  lot_id        INTEGER REFERENCES coupe_lots(id),
  qty           REAL    NOT NULL
                CHECK (CASE WHEN movement_type = 'ajustement'
                            THEN qty <> 0 ELSE qty > 0 END),
  unit          TEXT    NOT NULL DEFAULT 'kg',
  reason        TEXT    NOT NULL,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_st_waste_type ON st_waste_movements(waste_type);

-- Historique du module Stock (écritures immuables applicativement).
CREATE TABLE IF NOT EXISTS st_history (
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

CREATE INDEX IF NOT EXISTS idx_st_history_entity ON st_history(entity_type, entity_id);
