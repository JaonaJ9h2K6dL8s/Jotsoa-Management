-- Étape 10 : module Chef Sécurité (contrôle indépendant des sorties,
-- comptage physique des cartons, anomalies, décision et confirmation
-- de sortie). Migration non destructive.
-- Réutilise : mg_dossiers (champs security_* prévus à l'étape 9),
-- st_cartons/st_carton_lines, les réservations mg_reservations, les
-- alertes, les demandes sensibles (sensitive_requests). Le stock est
-- décrémenté une seule fois, via le service interne du module Stock,
-- à la confirmation de la sortie physique.

-- Contrôles de sécurité d'un dossier de sortie. Le niveau (cartons /
-- references / quantites) ne peut jamais être inférieur au niveau
-- par défaut configuré (app_meta sec_default_level).
CREATE TABLE IF NOT EXISTS sec_controles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT    NOT NULL UNIQUE,
  dossier_id  INTEGER NOT NULL REFERENCES mg_dossiers(id),
  version     INTEGER NOT NULL CHECK (version > 0),
  level       TEXT    NOT NULL CHECK (level IN ('cartons','references','quantites')),
  status      TEXT    NOT NULL DEFAULT 'en_cours'
              CHECK (status IN ('en_cours','conforme','non_conforme',
                                'attente_correction','invalide')),
  notes       TEXT,
  started_by  INTEGER NOT NULL REFERENCES users(id),
  started_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);

-- Un seul contrôle en cours par dossier.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sec_controles_active
  ON sec_controles(dossier_id) WHERE status = 'en_cours';
CREATE INDEX IF NOT EXISTS idx_sec_controles_dossier
  ON sec_controles(dossier_id, status);

-- Observations physiques : un carton compté une seule fois par
-- contrôle (contrainte d'unicité). result = attendu / supplementaire.
CREATE TABLE IF NOT EXISTS sec_observations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  controle_id INTEGER NOT NULL REFERENCES sec_controles(id),
  carton_id   INTEGER NOT NULL REFERENCES st_cartons(id),
  code_saisi  TEXT    NOT NULL,
  result      TEXT    NOT NULL CHECK (result IN ('attendu','supplementaire')),
  qty_total   INTEGER NOT NULL DEFAULT 0 CHECK (qty_total >= 0),
  observed_by INTEGER NOT NULL REFERENCES users(id),
  observed_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (controle_id, carton_id)
);

CREATE INDEX IF NOT EXISTS idx_sec_observations_controle
  ON sec_observations(controle_id);

-- Vérifications détaillées des quantités (niveau 3), par ligne de
-- commande : attendu = qty_prepared déclaré, vérifié = comptage réel.
CREATE TABLE IF NOT EXISTS sec_line_checks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  controle_id   INTEGER NOT NULL REFERENCES sec_controles(id),
  order_line_id INTEGER NOT NULL REFERENCES mg_order_lines(id),
  qty_checked   REAL    NOT NULL CHECK (qty_checked >= 0),
  checked_by    INTEGER NOT NULL REFERENCES users(id),
  checked_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (controle_id, order_line_id)
);

CREATE INDEX IF NOT EXISTS idx_sec_line_checks_controle
  ON sec_line_checks(controle_id);

-- Anomalies factuelles : une anomalie déclenche une vérification,
-- jamais une accusation. Résolution tracée ; les anomalies critiques
-- exigent une contre-vérification (sensitive_requests).
CREATE TABLE IF NOT EXISTS sec_anomalies (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  code              TEXT    NOT NULL UNIQUE,
  dossier_id        INTEGER REFERENCES mg_dossiers(id),
  controle_id       INTEGER REFERENCES sec_controles(id),
  carton_id         INTEGER REFERENCES st_cartons(id),
  type              TEXT    NOT NULL CHECK (type IN
                    ('carton_manquant','carton_supplementaire','carton_inconnu',
                     'qr_invalide','carton_double','carton_deja_sorti',
                     'reference_incoherente','quantite_ecart',
                     'dossier_modifie','dossier_incomplet',
                     'sortie_non_autorisee','incoherence_stock',
                     'echec_contre_verification')),
  severity          TEXT    NOT NULL CHECK (severity IN ('info','warning','critical')),
  description       TEXT    NOT NULL,
  status            TEXT    NOT NULL DEFAULT 'ouverte'
                    CHECK (status IN ('ouverte','resolue','acceptee')),
  detected_by       INTEGER REFERENCES users(id),
  detected_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  resolved_by       INTEGER REFERENCES users(id),
  resolved_at       TEXT,
  resolution        TEXT,
  resolution_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_sec_anomalies_dossier
  ON sec_anomalies(dossier_id, status);
CREATE INDEX IF NOT EXISTS idx_sec_anomalies_controle
  ON sec_anomalies(controle_id, status);

-- Historique append-only des décisions de contrôle d'un dossier.
CREATE TABLE IF NOT EXISTS sec_decisions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  dossier_id INTEGER NOT NULL REFERENCES mg_dossiers(id),
  controle_id INTEGER REFERENCES sec_controles(id),
  decision   TEXT    NOT NULL CHECK (decision IN
             ('conforme','non_conforme','attente_correction',
              'contrev_crequise','autorisee','refusee')),
  reason     TEXT,
  decided_by INTEGER NOT NULL REFERENCES users(id),
  decided_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sec_decisions_dossier
  ON sec_decisions(dossier_id);

-- Sorties : autorisation puis confirmation physique distinctes.
-- movement_logged = 1 quand le mouvement de stock définitif a été
-- enregistré (une seule fois, transaction avec le module Stock).
CREATE TABLE IF NOT EXISTS sec_sorties (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  code              TEXT    NOT NULL UNIQUE,
  dossier_id        INTEGER NOT NULL UNIQUE REFERENCES mg_dossiers(id),
  controle_id       INTEGER REFERENCES sec_controles(id),
  status            TEXT    NOT NULL DEFAULT 'autorisee'
                    CHECK (status IN ('autorisee','confirmee','refusee','annulee')),
  authorized_by     INTEGER NOT NULL REFERENCES users(id),
  authorized_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  authorized_reason TEXT,
  confirmed_by      INTEGER REFERENCES users(id),
  confirmed_at      TEXT,
  movement_logged   INTEGER NOT NULL DEFAULT 0 CHECK (movement_logged IN (0,1)),
  notes             TEXT
);

CREATE INDEX IF NOT EXISTS idx_sec_sorties_status ON sec_sorties(status);

-- Historique du module Sécurité (écritures immuables applicativement).
CREATE TABLE IF NOT EXISTS sec_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  action      TEXT    NOT NULL,
  entity_type TEXT    NOT NULL,
  entity_id   INTEGER NOT NULL,
  actor_id    INTEGER REFERENCES users(id),
  old_value   TEXT,
  new_value   TEXT,
  reason      TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sec_history_entity
  ON sec_history(entity_type, entity_id);
