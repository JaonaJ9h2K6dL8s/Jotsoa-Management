-- Étape 9 : module Chef Magasinier (import PDF, préparation des
-- commandes, dossiers de sortie). Migration non destructive.
-- Réutilise le catalogue (products/colors/sizes), les cartons du
-- module Stock (st_cartons/st_carton_lines), les alertes et le
-- mécanisme d'historique. Le stock n'est jamais décrémenté ici : les
-- réservations tracent la préparation, la sortie physique reste du
-- ressort du Chef Sécurité (étape 10) et du module Stock.

-- Documents PDF importés. L'empreinte sha256 bloque le même fichier
-- importé deux fois ; le texte extrait est conservé pour vérification.
CREATE TABLE IF NOT EXISTS mg_documents (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  code             TEXT    NOT NULL UNIQUE,
  file_name        TEXT    NOT NULL,
  sha256           TEXT    NOT NULL UNIQUE,
  size_bytes       INTEGER NOT NULL CHECK (size_bytes > 0),
  page_count       INTEGER,
  status           TEXT    NOT NULL DEFAULT 'importe'
                   CHECK (status IN ('importe','extraction_ok','extraction_partielle',
                                     'ocr_indisponible','a_verifier','valide',
                                     'rejete','erreur')),
  external_order_no TEXT,
  extracted_text   TEXT,
  imported_by      INTEGER NOT NULL REFERENCES users(id),
  imported_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  notes            TEXT
);

CREATE INDEX IF NOT EXISTS idx_mg_documents_status ON mg_documents(status);

-- Commande externe validée : une commande par document. Le numéro
-- externe est prioritaire et unique quand il est présent.
CREATE TABLE IF NOT EXISTS mg_orders (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  code              TEXT    NOT NULL UNIQUE,
  document_id       INTEGER NOT NULL UNIQUE REFERENCES mg_documents(id),
  external_order_no TEXT,
  client_name       TEXT,
  order_date        TEXT,
  status            TEXT    NOT NULL DEFAULT 'a_verifier'
                    CHECK (status IN ('a_verifier','valide','en_preparation',
                                      'partielle','complete','anomalie',
                                      'soumis','retour','annule')),
  validated_by      INTEGER REFERENCES users(id),
  validated_at      TEXT,
  notes             TEXT,
  created_by        INTEGER NOT NULL REFERENCES users(id),
  created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mg_orders_external
  ON mg_orders(external_order_no) WHERE external_order_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mg_orders_status ON mg_orders(status);

-- Lignes de commande : produit/couleur/taille reliés au catalogue
-- interne (NULL tant que la correspondance n'est pas faite). Les
-- valeurs extraites restent visibles dans raw_text.
CREATE TABLE IF NOT EXISTS mg_order_lines (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id      INTEGER NOT NULL REFERENCES mg_orders(id),
  product_id    INTEGER REFERENCES products(id),
  color_id      INTEGER REFERENCES colors(id),
  size_id       INTEGER REFERENCES sizes(id),
  raw_text      TEXT,
  qty_ordered   REAL    NOT NULL CHECK (qty_ordered > 0),
  qty_prepared  REAL    NOT NULL DEFAULT 0 CHECK (qty_prepared >= 0),
  match_status  TEXT    NOT NULL DEFAULT 'non_reconnu'
                CHECK (match_status IN ('non_reconnu','reconnu')),
  notes         TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mg_order_lines_order ON mg_order_lines(order_id);

-- Réservations de stock : traçables, par lot + taille + carton. Elles
-- empêchent deux commandes de réserver les mêmes pièces. La libération
-- est contrôlée et historisée ; aucune sortie physique n'est faite ici.
CREATE TABLE IF NOT EXISTS mg_reservations (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  code           TEXT    NOT NULL UNIQUE,
  order_id       INTEGER NOT NULL REFERENCES mg_orders(id),
  line_id        INTEGER NOT NULL REFERENCES mg_order_lines(id),
  lot_id         INTEGER NOT NULL REFERENCES coupe_lots(id),
  size_id        INTEGER NOT NULL REFERENCES sizes(id),
  carton_id      INTEGER NOT NULL REFERENCES st_cartons(id),
  qty            REAL    NOT NULL CHECK (qty > 0),
  status         TEXT    NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active','liberee')),
  reserved_by    INTEGER NOT NULL REFERENCES users(id),
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  released_by    INTEGER REFERENCES users(id),
  released_at    TEXT,
  release_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_mg_reservations_lot_size
  ON mg_reservations(lot_id, size_id, status);
CREATE INDEX IF NOT EXISTS idx_mg_reservations_carton
  ON mg_reservations(carton_id, status);
CREATE INDEX IF NOT EXISTS idx_mg_reservations_order ON mg_reservations(order_id);

-- Vérification de la préparation avant soumission : les écarts sont
-- calculés côté serveur et conservés (gaps en JSON).
CREATE TABLE IF NOT EXISTS mg_checks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER NOT NULL REFERENCES mg_orders(id),
  result     TEXT    NOT NULL CHECK (result IN ('conforme','partielle')),
  gaps       TEXT,
  notes      TEXT,
  checked_by INTEGER NOT NULL REFERENCES users(id),
  checked_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mg_checks_order ON mg_checks(order_id);

-- Dossier de sortie soumis au Chef Sécurité. Une seule version active
-- par commande ; une nouvelle version est créée après un retour. Les
-- champs security_* restent vides à l'étape 9 (décision de l'étape 10).
CREATE TABLE IF NOT EXISTS mg_dossiers (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  code                TEXT    NOT NULL UNIQUE,
  order_id            INTEGER NOT NULL REFERENCES mg_orders(id),
  version             INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  status              TEXT    NOT NULL DEFAULT 'soumis'
                      CHECK (status IN ('soumis','retour','annule')),
  notes               TEXT,
  submitted_by        INTEGER NOT NULL REFERENCES users(id),
  submitted_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  security_result     TEXT,
  security_checked_by INTEGER REFERENCES users(id),
  security_checked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_mg_dossiers_order ON mg_dossiers(order_id);

-- Historique du module Magasinier (écritures immuables applicativement).
CREATE TABLE IF NOT EXISTS mg_history (
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

CREATE INDEX IF NOT EXISTS idx_mg_history_entity ON mg_history(entity_type, entity_id);
