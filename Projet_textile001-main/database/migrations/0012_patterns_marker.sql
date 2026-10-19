-- Migration 0012 : bibliothèque de patrons et plans de marker (cahier §7-§9).
-- Chaque patron est lié à un produit, une catégorie, une pièce, une taille
-- et une version, avec son contour géométrique réel (cm) et ses contraintes
-- de placement. Les plans de marker enregistrent les propositions et
-- validations de placement. Non destructif : aucune donnée existante
-- n'est supprimée ni modifiée.

CREATE TABLE IF NOT EXISTS pattern_pieces (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id        INTEGER NOT NULL REFERENCES products(id),
  category          TEXT    NOT NULL DEFAULT 'adulte'
                    CHECK (category IN ('adulte','enfant')),
  piece_code        TEXT    NOT NULL,
  piece_label       TEXT    NOT NULL,
  size_id           INTEGER NOT NULL REFERENCES sizes(id),
  version           TEXT    NOT NULL DEFAULT 'v1',
  geometry_json     TEXT    NOT NULL CHECK (length(geometry_json) > 2),
  width_cm          REAL    NOT NULL CHECK (width_cm  > 0),
  height_cm         REAL    NOT NULL CHECK (height_cm > 0),
  qty_multiplier    INTEGER NOT NULL DEFAULT 1 CHECK (qty_multiplier BETWEEN 1 AND 20),
  grain_direction   TEXT    NOT NULL DEFAULT 'along'
                    CHECK (grain_direction IN ('along','cross','any')),
  allowed_rotations TEXT    NOT NULL DEFAULT '[0,180]',
  seam_allowance_cm REAL    NOT NULL DEFAULT 1 CHECK (seam_allowance_cm >= 0),
  is_validated      INTEGER NOT NULL DEFAULT 1 CHECK (is_validated IN (0,1)),
  validated_by      INTEGER REFERENCES users(id),
  validated_at      TEXT,
  notes             TEXT,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (product_id, category, piece_code, size_id, version)
);

CREATE INDEX IF NOT EXISTS idx_pattern_pieces_product
  ON pattern_pieces(product_id, category, size_id);
CREATE INDEX IF NOT EXISTS idx_pattern_pieces_size ON pattern_pieces(size_id);

CREATE TABLE IF NOT EXISTS marker_plans (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  lot_id            INTEGER REFERENCES coupe_lots(id),
  product_id        INTEGER NOT NULL REFERENCES products(id),
  category          TEXT    NOT NULL DEFAULT 'adulte'
                    CHECK (category IN ('adulte','enfant')),
  usable_width_cm   REAL    NOT NULL CHECK (usable_width_cm  > 0),
  matelas_length_cm REAL    NOT NULL CHECK (matelas_length_cm > 0),
  layers            INTEGER NOT NULL CHECK (layers BETWEEN 1 AND 40),
  gap_cm            REAL    NOT NULL DEFAULT 1 CHECK (gap_cm >= 0),
  grammage_g_m2     REAL    CHECK (grammage_g_m2 IS NULL OR grammage_g_m2 > 0),
  sizes_json        TEXT    NOT NULL,
  pieces_json       TEXT    NOT NULL,
  marker_length_cm  REAL    NOT NULL CHECK (marker_length_cm > 0),
  total_pieces      INTEGER NOT NULL CHECK (total_pieces >= 0),
  placed_area_m2    REAL    NOT NULL CHECK (placed_area_m2 >= 0),
  available_area_m2 REAL    NOT NULL CHECK (available_area_m2 > 0),
  efficiency        REAL    NOT NULL CHECK (efficiency >= 0 AND efficiency <= 100),
  waste_area_m2     REAL    NOT NULL CHECK (waste_area_m2 >= 0),
  waste_kg_est      REAL    CHECK (waste_kg_est IS NULL OR waste_kg_est >= 0),
  status            TEXT    NOT NULL DEFAULT 'proposition'
                    CHECK (status IN ('proposition','valide')),
  created_by        INTEGER NOT NULL REFERENCES users(id),
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_marker_plans_product ON marker_plans(product_id);
CREATE INDEX IF NOT EXISTS idx_marker_plans_lot ON marker_plans(lot_id);
CREATE INDEX IF NOT EXISTS idx_marker_plans_status ON marker_plans(status);

-- Patrons de départ (contours simplifiés à l'échelle réelle, à affiner
-- avec la numérisation des patrons papier). Échelle par taille :
-- XS 0.88, S 0.94, M 1.00, L 1.06, XL 1.12, XXL 1.18.
-- Famille T-shirt : devant, dos, manche ×2, col.
-- Famille Polo : devant, dos, manche ×2, col, patte de boutonnage ×2.
-- Famille Short : devant ×2, dos ×2, ceinture.

WITH scale AS (
  SELECT s.id AS size_id, s.nom AS size_nom,
    CASE s.nom
      WHEN 'XS' THEN 0.88 WHEN 'S' THEN 0.94 WHEN 'M' THEN 1.00
      WHEN 'L' THEN 1.06 WHEN 'XL' THEN 1.12 WHEN 'XXL' THEN 1.18
      ELSE 1.00
    END AS k
  FROM sizes s WHERE s.is_active = 1
),
adult_products AS (
  SELECT p.id, p.nom FROM products p
  JOIN product_types t ON t.id = p.product_type_id
  WHERE t.nom = 'Vêtements pour adultes' AND p.is_active = 1
    AND p.nom IN ('T-shirt', 'Polo')
),
enfant_products AS (
  SELECT p.id, p.nom FROM products p
  JOIN product_types t ON t.id = p.product_type_id
  WHERE t.nom = 'Vêtements pour enfants' AND p.is_active = 1
    AND p.nom = 'Short'
),
pieces_def (
  product_nom, piece_code, piece_label, w_base, h_base, mult, grain, rotations
) AS (
  VALUES
    ('T-shirt','devant','Devant',        58.0, 72.0, 1, 'along', '[0,180]'),
    ('T-shirt','dos','Dos',              58.0, 72.0, 1, 'along', '[0,180]'),
    ('T-shirt','manche','Manche',        44.0, 26.0, 2, 'along', '[0,180]'),
    ('T-shirt','col','Col / bord-côte',  48.0,  8.0, 1, 'any',   '[0,90,180,270]'),
    ('Polo','devant','Devant',           58.0, 72.0, 1, 'along', '[0,180]'),
    ('Polo','dos','Dos',                 58.0, 72.0, 1, 'along', '[0,180]'),
    ('Polo','manche','Manche',           46.0, 26.0, 2, 'along', '[0,180]'),
    ('Polo','col','Col polo',            50.0,  9.0, 1, 'any',   '[0,90,180,270]'),
    ('Polo','patte','Patte de boutonnage', 6.0, 18.0, 2, 'along', '[0,180]'),
    ('Short','devant','Devant jambe',    36.0, 52.0, 2, 'along', '[0,180]'),
    ('Short','dos','Dos jambe',          36.0, 52.0, 2, 'along', '[0,180]'),
    ('Short','ceinture','Ceinture',      80.0,  6.0, 1, 'any',   '[0,90,180,270]')
)
INSERT INTO pattern_pieces
  (product_id, category, piece_code, piece_label, size_id, version,
   geometry_json, width_cm, height_cm, qty_multiplier, grain_direction,
   allowed_rotations, seam_allowance_cm, is_validated, notes)
SELECT
  COALESCE(ap.id, ep.id), CASE WHEN ap.id IS NOT NULL THEN 'adulte' ELSE 'enfant' END,
  d.piece_code, d.piece_label, sc.size_id, 'v1',
  json_object('points', json_array(
    json_array(0, 0),
    json_array(d.w_base * sc.k, 0),
    json_array(d.w_base * sc.k, d.h_base * sc.k * 0.28),
    json_array(d.w_base * sc.k * 0.82, d.h_base * sc.k * 0.34),
    json_array(d.w_base * sc.k * 0.82, d.h_base * sc.k),
    json_array(d.w_base * sc.k * 0.18, d.h_base * sc.k),
    json_array(d.w_base * sc.k * 0.18, d.h_base * sc.k * 0.34),
    json_array(0, d.h_base * sc.k * 0.28)
  )),
  d.w_base * sc.k, d.h_base * sc.k, d.mult, d.grain,
  d.rotations, 1.0, 1,
  'Contour simplifié de départ — à remplacer par la numérisation du patron papier validé.'
FROM pieces_def d
LEFT JOIN adult_products ap ON ap.nom = d.product_nom
LEFT JOIN enfant_products ep ON ep.nom = d.product_nom
CROSS JOIN scale sc
WHERE COALESCE(ap.id, ep.id) IS NOT NULL
  AND NOT EXISTS (
  SELECT 1 FROM pattern_pieces pp
  WHERE pp.product_id = COALESCE(ap.id, ep.id) AND pp.category = (CASE WHEN ap.id IS NOT NULL THEN 'adulte' ELSE 'enfant' END)
    AND pp.piece_code = d.piece_code AND pp.size_id = sc.size_id AND pp.version = 'v1'
);
