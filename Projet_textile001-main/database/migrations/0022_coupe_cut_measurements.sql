-- Migration 0022 : relevés de mesure atelier (phase 5.1).
-- Deux tables ADDITIVES uniquement — aucune modification des tables
-- existantes, aucun trigger sur rouleaux/mouvements/plans : le stock
-- et les historiques restent pilotés par les mécanismes des phases 3/4.
--
-- Sémantique validée :
-- - la pesée primaire porte sur le ROULEAU (entier avant / restant
--   après), jamais sur le tissu déroulé au sol ;
-- - consumed_kg = roll_weight_before_kg - roll_weight_after_kg est une
--   valeur de SESSION : jamais répartie artificiellement entre plans ;
-- - le poids des pièces et des chutes est un contrôle DIAGNOSTIQUE
--   facultatif, jamais une égalité obligatoire ;
-- - une correction crée une nouvelle version (replaces_id) ; aucune
--   suppression physique d'une session finalisée ou invalidée.
--
-- Remarque de conception : la règle « un plan appartient à une seule
-- session ACTIVE » est contrôlée applicativement (et non par UNIQUE
-- sur plan_id) afin que la correction par version puisse rattacher
-- les mêmes plans à la nouvelle session — l'ancienne version, alors
-- invalidée, ne bloque plus.

CREATE TABLE IF NOT EXISTS coupe_cut_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  roll_id INTEGER NOT NULL REFERENCES coupe_rolls(id),
  status TEXT NOT NULL DEFAULT 'brouillon'
    CHECK (status IN ('brouillon', 'complet', 'invalide')),
  roll_weight_before_kg REAL
    CHECK (roll_weight_before_kg IS NULL OR roll_weight_before_kg >= 0),
  roll_weight_after_kg REAL
    CHECK (roll_weight_after_kg IS NULL OR roll_weight_after_kg >= 0),
  consumed_kg REAL
    CHECK (consumed_kg IS NULL OR consumed_kg >= 0),
  measured_gsm REAL
    CHECK (measured_gsm IS NULL OR measured_gsm > 0),
  measured_width_cm REAL
    CHECK (measured_width_cm IS NULL OR measured_width_cm > 0),
  instrument TEXT,
  bilan_flag TEXT CHECK (bilan_flag IS NULL OR bilan_flag IN ('ok', 'bilan_ecart')),
  bilan_comment TEXT,
  operator_id INTEGER NOT NULL REFERENCES users(id),
  finalized_by INTEGER REFERENCES users(id),
  finalized_at TEXT,
  invalide_reason TEXT,
  replaces_id INTEGER REFERENCES coupe_cut_sessions(id),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (roll_weight_after_kg IS NULL OR roll_weight_before_kg IS NULL
         OR roll_weight_after_kg <= roll_weight_before_kg)
);

-- Une seule session OUVERTE (brouillon) par rouleau : impossible
-- d'avoir deux intervalles de mesure simultanés sur le même rouleau.
-- Les sessions complètes et invalidées ne bloquent pas : un rouleau
-- peut porter plusieurs sessions successives (pesées successives).
CREATE UNIQUE INDEX IF NOT EXISTS uq_cut_session_active
  ON coupe_cut_sessions(roll_id)
  WHERE status = 'brouillon';
CREATE INDEX IF NOT EXISTS idx_cut_sessions_roll ON coupe_cut_sessions(roll_id);
CREATE INDEX IF NOT EXISTS idx_cut_sessions_status ON coupe_cut_sessions(status);

CREATE TABLE IF NOT EXISTS coupe_cut_plan_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES coupe_cut_sessions(id),
  plan_id INTEGER NOT NULL REFERENCES marker_plans(id),
  roll_id INTEGER NOT NULL REFERENCES coupe_rolls(id),
  length_used_m REAL
    CHECK (length_used_m IS NULL OR length_used_m > 0),
  chutes_kg REAL CHECK (chutes_kg IS NULL OR chutes_kg >= 0),
  pieces_kg REAL CHECK (pieces_kg IS NULL OR pieces_kg >= 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cut_plan_records_session
  ON coupe_cut_plan_records(session_id);
CREATE INDEX IF NOT EXISTS idx_cut_plan_records_plan
  ON coupe_cut_plan_records(plan_id);

-- Tolérance du bilan matière (arbitrage 4) : paramètres persistants,
-- modifiables par l'administrateur via l'API dédiée.
-- tol = max(3 × sqrt(u_avant² + u_après²), plancher)
-- u = 0,1 kg est la précision SUPPOSÉE de la balance de coupe : elle
-- doit être confirmée par l'atelier — aucune balance n'est présumée
-- conforme a priori, et cette valeur ne conditionne jamais la formule
-- de consommation réelle (before − after), uniquement le drapeau de
-- bilan diagnostique.
INSERT OR IGNORE INTO app_meta (key, value) VALUES
  ('coupe_scale_uncertainty_kg', '0.1'),
  ('coupe_bilan_tolerance_floor_kg', '0.3');
