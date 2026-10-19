-- Étape 17 : workflow automatisé des lots de coupe.
-- Étend les statuts de lot et ajoute les liens commande/plan/rouleau/table/anomalies.
-- Aucune donnée existante n'est supprimée ; les statuts anciens restent valides.

-- Extension des statuts de lot pour le workflow automatisé.
-- SQLite ne permet pas de modifier une contrainte CHECK directement :
-- on recrée la table si nécessaire, en préservant les données.
PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS coupe_lots_new (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  code              TEXT    NOT NULL,
  order_id          INTEGER REFERENCES orders(id),
  product_id        INTEGER NOT NULL REFERENCES products(id),
  color_id          INTEGER NOT NULL REFERENCES colors(id),
  roll_id           INTEGER REFERENCES coupe_rolls(id),
  marker_plan_id    INTEGER REFERENCES marker_plans(id),
  coupe_table_id    INTEGER REFERENCES coupe_tables(id),
  total_planned_qty REAL    NOT NULL DEFAULT 0 CHECK (total_planned_qty >= 0),
  proposed_layers   INTEGER CHECK (proposed_layers > 0),
  proposed_matelas_length_cm REAL CHECK (proposed_matelas_length_cm > 0),
  status            TEXT    NOT NULL DEFAULT 'brouillon'
                    CHECK (status IN (
                      'brouillon','a_verifier','plan_a_valider','pret_a_couper',
                      'en_coupe','resultat_a_confirmer','coupe','transfert_pret',
                      'pret_transfert','transfere','annule','bloque'
                    )),
  responsable_id    INTEGER NOT NULL REFERENCES users(id),
  notes             TEXT,
  started_at        TEXT,
  finished_at       TEXT,
  validated_by      INTEGER REFERENCES users(id),
  validated_at      TEXT,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO coupe_lots_new (
  id, code, order_id, product_id, color_id, roll_id, marker_plan_id,
  coupe_table_id, total_planned_qty, proposed_layers, proposed_matelas_length_cm,
  status, responsable_id, notes, started_at, finished_at, validated_by,
  validated_at, created_at, updated_at
)
SELECT
  id, code, NULL, product_id, color_id, NULL, NULL, NULL,
  total_planned_qty, NULL, NULL,
  CASE status
    WHEN 'en_cours' THEN 'en_coupe'
    WHEN 'attente_validation' THEN 'resultat_a_confirmer'
    ELSE status
  END,
  responsable_id, notes, started_at, finished_at, NULL, NULL,
  created_at, updated_at
FROM coupe_lots;

DROP TABLE coupe_lots;
ALTER TABLE coupe_lots_new RENAME TO coupe_lots;

CREATE UNIQUE INDEX IF NOT EXISTS idx_coupe_lots_code ON coupe_lots(code);
CREATE INDEX IF NOT EXISTS idx_coupe_lots_status ON coupe_lots(status);
CREATE INDEX IF NOT EXISTS idx_coupe_lots_product ON coupe_lots(product_id);
CREATE INDEX IF NOT EXISTS idx_coupe_lots_order ON coupe_lots(order_id);
CREATE INDEX IF NOT EXISTS idx_coupe_lots_marker_plan ON coupe_lots(marker_plan_id);
CREATE INDEX IF NOT EXISTS idx_coupe_lots_roll ON coupe_lots(roll_id);

PRAGMA foreign_keys = ON;

-- Table des anomalies de coupe liées à un lot.
CREATE TABLE IF NOT EXISTS coupe_lot_anomalies (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  lot_id      INTEGER NOT NULL REFERENCES coupe_lots(id) ON DELETE CASCADE,
  size_id     INTEGER REFERENCES sizes(id),
  type        TEXT    NOT NULL
                CHECK (type IN (
                  'tissu_defectueux','piece_manquante','quantite_incorrecte',
                  'probleme_patron','probleme_materiel','autre'
                )),
  qty         REAL    NOT NULL DEFAULT 0 CHECK (qty >= 0),
  motif       TEXT,
  created_by  INTEGER NOT NULL REFERENCES users(id),
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_coupe_lot_anomalies_lot ON coupe_lot_anomalies(lot_id);
CREATE INDEX IF NOT EXISTS idx_coupe_lot_anomalies_type ON coupe_lot_anomalies(type);

-- Mise à jour automatique de updated_at.
CREATE TRIGGER IF NOT EXISTS trg_coupe_lots_updated_at
AFTER UPDATE ON coupe_lots
BEGIN
  UPDATE coupe_lots SET updated_at = datetime('now') WHERE id = NEW.id;
END;
