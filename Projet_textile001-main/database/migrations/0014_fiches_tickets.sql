-- Fiches techniques (cahier §3 et §21) : données réellement enregistrées,
-- versionnées ; aucune valeur codée en dur dans les interfaces.
CREATE TABLE IF NOT EXISTS fiches_techniques (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  size_id INTEGER REFERENCES sizes(id),
  color_nom TEXT,
  modele TEXT,
  coupe TEXT,
  fabric_type TEXT,
  composition TEXT,
  grammage_g_m2 REAL,
  largeur_rouleau_cm REAL,
  largeur_utile_cm REAL,
  elasticite TEXT,
  droit_fil TEXT,
  mesures_json TEXT NOT NULL DEFAULT '[]',
  confection_json TEXT NOT NULL DEFAULT '[]',
  consommation_theorique_m REAL,
  statut TEXT NOT NULL DEFAULT 'brouillon'
    CHECK (statut IN ('brouillon', 'a_verifier', 'valide', 'archive')),
  version INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  validated_by INTEGER REFERENCES users(id),
  validated_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Historique des versions : chaque modification validée archéficie
-- l'ancienne version — jamais écrasée silencieusement (§21.E).
CREATE TABLE IF NOT EXISTS fiche_technique_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fiche_id INTEGER NOT NULL REFERENCES fiches_techniques(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  data_json TEXT NOT NULL,
  statut TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Tickets de production avec QR code (cahier §20) : coupe, transfert
-- vers la couture, suivi. Identifiant unique jamais réutilisé.
CREATE TABLE IF NOT EXISTS production_tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('coupe', 'transfert', 'suivi')),
  lot_id INTEGER REFERENCES coupe_lots(id),
  plan_id INTEGER REFERENCES marker_plans(id),
  ref_operation TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  qr_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'actif'
    CHECK (status IN ('actif', 'annule')),
  reprint_count INTEGER NOT NULL DEFAULT 0,
  last_reprint_by INTEGER REFERENCES users(id),
  last_reprint_at TEXT,
  observations TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tickets_code ON production_tickets(code);
CREATE INDEX IF NOT EXISTS idx_fiches_product ON fiches_techniques(product_id);
