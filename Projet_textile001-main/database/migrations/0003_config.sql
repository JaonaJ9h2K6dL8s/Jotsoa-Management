-- Migration 0003 : configuration générale (étape 3).
-- Types de produits, produits, couleurs, tailles, zones de retouche,
-- défauts qualité, salles/lignes de couture, cadences, associations.
-- Données de référence initiales insérées une seule fois (OR IGNORE).

CREATE TABLE IF NOT EXISTS product_types (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  nom         TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_types_nom
  ON product_types(LOWER(TRIM(nom)));

-- Produit concret (modèle) : distinct du type et des variantes.
CREATE TABLE IF NOT EXISTS products (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  nom             TEXT    NOT NULL,
  description     TEXT    NOT NULL DEFAULT '',
  product_type_id INTEGER NOT NULL REFERENCES product_types(id),
  is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_products_type ON products(product_type_id);

CREATE TABLE IF NOT EXISTS colors (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  nom        TEXT    NOT NULL,
  hex_code   TEXT,
  is_active  INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_colors_nom ON colors(LOWER(TRIM(nom)));

CREATE TABLE IF NOT EXISTS sizes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nom           TEXT    NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 1 CHECK (display_order BETWEEN 1 AND 999),
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sizes_nom ON sizes(LOWER(TRIM(nom)));

-- Modèle préparé : tailles autorisées par type, couleurs/tailles par produit.
CREATE TABLE IF NOT EXISTS product_type_sizes (
  product_type_id INTEGER NOT NULL REFERENCES product_types(id) ON DELETE CASCADE,
  size_id         INTEGER NOT NULL REFERENCES sizes(id) ON DELETE CASCADE,
  PRIMARY KEY (product_type_id, size_id)
);
CREATE TABLE IF NOT EXISTS product_colors (
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  color_id   INTEGER NOT NULL REFERENCES colors(id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, color_id)
);
CREATE TABLE IF NOT EXISTS product_sizes (
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  size_id    INTEGER NOT NULL REFERENCES sizes(id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, size_id)
);

CREATE TABLE IF NOT EXISTS rework_zones (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nom           TEXT    NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 1 CHECK (display_order BETWEEN 1 AND 999),
  is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rework_zones_nom
  ON rework_zones(LOWER(TRIM(nom)));
CREATE TABLE IF NOT EXISTS rework_zone_product_types (
  zone_id         INTEGER NOT NULL REFERENCES rework_zones(id) ON DELETE CASCADE,
  product_type_id INTEGER NOT NULL REFERENCES product_types(id) ON DELETE CASCADE,
  PRIMARY KEY (zone_id, product_type_id)
);

CREATE TABLE IF NOT EXISTS defects (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT    NOT NULL,
  nom         TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  category    TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_defects_code ON defects(UPPER(TRIM(code)));
CREATE UNIQUE INDEX IF NOT EXISTS idx_defects_nom  ON defects(LOWER(TRIM(nom)));
CREATE INDEX IF NOT EXISTS idx_defects_category ON defects(category);
CREATE TABLE IF NOT EXISTS defect_product_types (
  defect_id       INTEGER NOT NULL REFERENCES defects(id) ON DELETE CASCADE,
  product_type_id INTEGER NOT NULL REFERENCES product_types(id) ON DELETE CASCADE,
  PRIMARY KEY (defect_id, product_type_id)
);
CREATE TABLE IF NOT EXISTS defect_rework_zones (
  defect_id INTEGER NOT NULL REFERENCES defects(id) ON DELETE CASCADE,
  zone_id   INTEGER NOT NULL REFERENCES rework_zones(id) ON DELETE CASCADE,
  PRIMARY KEY (defect_id, zone_id)
);

-- Trois salles de couture distinctes (insérées une seule fois).
CREATE TABLE IF NOT EXISTS sewing_rooms (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT    NOT NULL UNIQUE,
  nom         TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Trois salles initiales (insérées une seule fois, jamais recréées).
INSERT OR IGNORE INTO sewing_rooms (code, nom, description) VALUES
  ('SALLE-1', 'Salle de couture 1', 'Première salle de couture.'),
  ('SALLE-2', 'Salle de couture 2', 'Deuxième salle de couture.'),
  ('SALLE-3', 'Salle de couture 3', 'Troisième salle de couture.');
CREATE TABLE IF NOT EXISTS sewing_lines (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code       TEXT    NOT NULL,
  nom        TEXT    NOT NULL,
  room_id    INTEGER NOT NULL REFERENCES sewing_rooms(id),
  is_active  INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (room_id, code)
);
CREATE INDEX IF NOT EXISTS idx_sewing_lines_room ON sewing_lines(room_id);

-- Cadences : une seule configuration active par contexte
-- (type de produit, salle, ligne) — index unique partiel.
CREATE TABLE IF NOT EXISTS production_cadences (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  product_type_id INTEGER REFERENCES product_types(id),
  room_id         INTEGER REFERENCES sewing_rooms(id),
  line_id         INTEGER REFERENCES sewing_lines(id),
  cadence_value   REAL    NOT NULL CHECK (cadence_value > 0),
  unit            TEXT    NOT NULL,
  period          TEXT    NOT NULL CHECK (period IN ('heure', 'jour')),
  start_date      TEXT    NOT NULL,
  end_date        TEXT,
  is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cadences_active_context
  ON production_cadences(IFNULL(product_type_id, 0), IFNULL(room_id, 0), IFNULL(line_id, 0))
  WHERE is_active = 1;
CREATE INDEX IF NOT EXISTS idx_cadences_type ON production_cadences(product_type_id);
CREATE INDEX IF NOT EXISTS idx_cadences_line ON production_cadences(line_id);

-- Paramètres généraux : réutilise la table app_meta existante.
INSERT OR IGNORE INTO app_meta (key, value) VALUES
  ('company_name', 'JO'),
  ('timezone', 'Indian/Antananarivo'),
  ('date_format', 'dd/MM/yyyy'),
  ('default_page_size', '25');

-- Données de référence initiales (décision projet) : types de produits.
INSERT OR IGNORE INTO product_types (nom, description) VALUES
  ('T-shirt',  'Produit supérieur à manches courtes.'),
  ('Polo',     'Produit supérieur à col et boutonnage.'),
  ('Short',    'Produit inférieur court.'),
  ('Pantalon', 'Produit inférieur long.'),
  ('Jogging',  'Produit inférieur confort, taille élastique.');

INSERT OR IGNORE INTO colors (nom, hex_code) VALUES
  ('Noir', '#111827'), ('Blanc', '#F9FAFB'), ('Bleu', '#1D4ED8'),
  ('Rouge', '#DC2626'), ('Vert', '#15803D'), ('Gris', '#6B7280');

INSERT OR IGNORE INTO sizes (nom, display_order) VALUES
  ('XS', 1), ('S', 2), ('M', 3), ('L', 4), ('XL', 5), ('XXL', 6);

-- Zones de retouche indicatives (modifiables par l''administrateur).
INSERT OR IGNORE INTO rework_zones (nom, display_order) VALUES
  ('Col', 1), ('Épaule', 2), ('Manche', 3), ('Assemblage', 4),
  ('Côté', 5), ('Bas du vêtement', 6),
  ('Ceinture', 7), ('Poche', 8), ('Entrejambe', 9), ('Jambe', 10),
  ('Bas du pantalon', 11);

INSERT OR IGNORE INTO rework_zone_product_types (zone_id, product_type_id)
  SELECT z.id, t.id FROM rework_zones z JOIN product_types t
  ON t.nom IN ('T-shirt', 'Polo')
  WHERE z.nom IN ('Col', 'Épaule', 'Manche', 'Assemblage', 'Côté', 'Bas du vêtement');

INSERT OR IGNORE INTO rework_zone_product_types (zone_id, product_type_id)
  SELECT z.id, t.id FROM rework_zones z JOIN product_types t
  ON t.nom IN ('Short', 'Pantalon', 'Jogging')
  WHERE z.nom IN ('Ceinture', 'Poche', 'Entrejambe', 'Jambe', 'Bas du pantalon');

INSERT OR IGNORE INTO defects (code, nom, description, category) VALUES
  ('DEF-001', 'Couture ouverte',     'Couture non refermée ou cassée.',     'Couture'),
  ('DEF-002', 'Point manquant',      'Points absents sur une ligne.',       'Couture'),
  ('DEF-003', 'Mauvais assemblage',  'Pièces mal alignées ou inversées.',   'Assemblage'),
  ('DEF-004', 'Tache',               'Tache d''huile, marque ou salissure.', 'Propreté'),
  ('DEF-005', 'Erreur de dimension', 'Mesure hors tolérance.',              'Dimensions'),
  ('DEF-006', 'Défaut de finition',  'Finition imparfaite (fil, ourlet).',  'Finition');
