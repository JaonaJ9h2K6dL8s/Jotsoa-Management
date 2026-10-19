CREATE TABLE coupe_catalogue (
  product_id INTEGER PRIMARY KEY REFERENCES products(id),
  family TEXT NOT NULL CHECK (family IN ('tshirt','polo','short','jogging','ensemble')),
  category TEXT NOT NULL CHECK (category IN ('adulte','enfant')),
  size_names_json TEXT NOT NULL,
  measurement_labels_json TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1))
);

INSERT INTO products (nom, description, product_type_id)
SELECT names.nom, '', types.id FROM
  (SELECT 'Short' nom UNION ALL SELECT 'Jogging') names
  JOIN product_types types ON types.nom IN ('Vêtements pour adultes','Vêtements pour enfants')
WHERE NOT EXISTS (SELECT 1 FROM products existing WHERE existing.product_type_id = types.id AND lower(trim(existing.nom)) = lower(names.nom));

INSERT OR IGNORE INTO sizes (nom, display_order) VALUES
  ('2 ans', 202), ('4 ans', 204), ('6 ans', 206), ('8 ans', 208), ('10 ans', 210), ('12 ans', 212);

INSERT INTO coupe_catalogue (product_id, family, category, size_names_json, measurement_labels_json)
SELECT products.id,
  CASE products.nom WHEN 'T-shirt' THEN 'tshirt' WHEN 'Polo' THEN 'polo' WHEN 'Short' THEN 'short' WHEN 'Jogging' THEN 'jogging' ELSE 'ensemble' END,
  CASE WHEN types.nom = 'Vêtements pour enfants' THEN 'enfant' ELSE 'adulte' END,
  CASE WHEN types.nom = 'Vêtements pour enfants' THEN '["2 ans","4 ans","6 ans","8 ans","10 ans","12 ans"]' ELSE '["S","M","L","XL"]' END,
  CASE
    WHEN products.nom = 'T-shirt' THEN '["Poitrine à plat","Longueur totale","Épaules","Longueur manche","Ouverture manche","Largeur bas","Encolure"]'
    WHEN products.nom = 'Polo' THEN '["Poitrine à plat","Longueur totale","Épaules","Longueur manche","Ouverture manche","Col","Longueur patte","Largeur patte"]'
    WHEN products.nom = 'Ensemble short + T-shirt' THEN '["Haut : poitrine","Haut : longueur","Haut : épaules","Haut : manche","Haut : ouverture manche","Haut : encolure","Short : taille","Short : hanches","Short : longueur","Short : entrejambe","Short : ouverture jambe","Short : ceinture"]'
    ELSE '["Taille détendue","Taille étirée","Hanches","Longueur extérieure","Entrejambe","Ouverture bas","Hauteur ceinture"]'
  END
FROM products JOIN product_types types ON types.id = products.product_type_id
WHERE (types.nom = 'Vêtements pour adultes' AND products.nom IN ('T-shirt','Polo','Short','Jogging'))
   OR (types.nom = 'Vêtements pour enfants' AND products.nom IN ('T-shirt','Short','Jogging','Ensemble short + T-shirt'));

INSERT OR IGNORE INTO product_sizes (product_id, size_id)
SELECT catalogue.product_id, sizes.id FROM coupe_catalogue catalogue
JOIN json_each(catalogue.size_names_json) allowed JOIN sizes ON sizes.nom = allowed.value;

CREATE TABLE pattern_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  size_id INTEGER NOT NULL REFERENCES sizes(id),
  model_name TEXT NOT NULL,
  fabric_ref TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  fiche_id INTEGER NOT NULL REFERENCES fiches_techniques(id),
  fiche_version INTEGER NOT NULL,
  source_name TEXT NOT NULL,
  source_unit TEXT NOT NULL CHECK (source_unit IN ('cm','mm')),
  scale_verified INTEGER NOT NULL DEFAULT 0 CHECK (scale_verified IN (0,1)),
  status TEXT NOT NULL DEFAULT 'brouillon' CHECK (status IN ('brouillon','a_verifier','valide','archive')),
  fiche_snapshot_json TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  validated_by INTEGER REFERENCES users(id),
  validated_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(product_id, size_id, model_name, fabric_ref, version)
);

ALTER TABLE pattern_pieces ADD COLUMN revision_id INTEGER REFERENCES pattern_revisions(id);
ALTER TABLE pattern_pieces ADD COLUMN component TEXT NOT NULL DEFAULT 'principal' CHECK (component IN ('principal','haut','short'));
ALTER TABLE pattern_pieces ADD COLUMN role_code TEXT;
ALTER TABLE pattern_pieces ADD COLUMN seam_included INTEGER NOT NULL DEFAULT 0 CHECK (seam_included IN (0,1));
ALTER TABLE pattern_pieces ADD COLUMN marks_json TEXT NOT NULL DEFAULT '[]';
CREATE INDEX idx_pattern_revision ON pattern_pieces(revision_id);

ALTER TABLE coupe_rolls ADD COLUMN width_cm REAL CHECK (width_cm > 0);
ALTER TABLE coupe_rolls ADD COLUMN usable_width_cm REAL CHECK (usable_width_cm > 0);
ALTER TABLE coupe_rolls ADD COLUMN grammage_g_m2 REAL CHECK (grammage_g_m2 > 0);
ALTER TABLE coupe_rolls ADD COLUMN fabric_lot TEXT;
ALTER TABLE coupe_rolls ADD COLUMN constraints_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE marker_plans ADD COLUMN input_json TEXT;
ALTER TABLE marker_plans ADD COLUMN source_fingerprint TEXT;
ALTER TABLE marker_plans ADD COLUMN roll_id INTEGER REFERENCES coupe_rolls(id);
ALTER TABLE marker_plans ADD COLUMN planned_start TEXT;
ALTER TABLE marker_plans ADD COLUMN planned_end TEXT;
ALTER TABLE marker_plans ADD COLUMN validated_by INTEGER REFERENCES users(id);
ALTER TABLE marker_plans ADD COLUMN validated_at TEXT;
ALTER TABLE marker_plans ADD COLUMN result_task_id INTEGER REFERENCES coupe_tasks(id);
ALTER TABLE marker_plans ADD COLUMN actual_json TEXT;
CREATE INDEX idx_marker_reservation ON marker_plans(coupe_table_id,status,planned_start,planned_end);

CREATE TABLE coupe_component_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL REFERENCES marker_plans(id),
  size_id INTEGER NOT NULL REFERENCES sizes(id),
  pattern_id INTEGER NOT NULL REFERENCES pattern_pieces(id),
  component TEXT NOT NULL CHECK (component IN ('principal','haut','short')),
  expected_qty INTEGER NOT NULL CHECK (expected_qty >= 0),
  cut_qty INTEGER NOT NULL CHECK (cut_qty >= 0),
  usable_qty INTEGER NOT NULL CHECK (usable_qty BETWEEN 0 AND cut_qty),
  UNIQUE(plan_id,pattern_id)
);

CREATE TRIGGER protect_approved_pattern_update BEFORE UPDATE ON pattern_pieces
WHEN OLD.revision_id IS NOT NULL AND EXISTS (SELECT 1 FROM pattern_revisions WHERE id = OLD.revision_id AND status IN ('valide','archive'))
BEGIN SELECT RAISE(ABORT, 'Patron approuvé immuable : créer une nouvelle version.'); END;
CREATE TRIGGER protect_approved_pattern_delete BEFORE DELETE ON pattern_pieces
WHEN OLD.revision_id IS NOT NULL AND EXISTS (SELECT 1 FROM pattern_revisions WHERE id = OLD.revision_id AND status IN ('valide','archive'))
BEGIN SELECT RAISE(ABORT, 'Historique de patron protégé.'); END;
CREATE TRIGGER protect_approved_pattern_insert BEFORE INSERT ON pattern_pieces
WHEN NEW.revision_id IS NOT NULL AND EXISTS (SELECT 1 FROM pattern_revisions WHERE id = NEW.revision_id AND status IN ('valide','archive'))
BEGIN SELECT RAISE(ABORT, 'Révision approuvée immuable.'); END;
CREATE TRIGGER protect_approved_revision BEFORE UPDATE ON pattern_revisions
WHEN OLD.status IN ('valide','archive') AND NOT (
  OLD.status = 'valide' AND NEW.status = 'archive' AND NEW.product_id = OLD.product_id
  AND NEW.size_id = OLD.size_id AND NEW.model_name = OLD.model_name AND NEW.fabric_ref = OLD.fabric_ref
  AND NEW.version = OLD.version AND NEW.fiche_id = OLD.fiche_id AND NEW.fiche_version = OLD.fiche_version
  AND NEW.source_name = OLD.source_name AND NEW.source_unit = OLD.source_unit
  AND NEW.scale_verified = OLD.scale_verified AND NEW.fiche_snapshot_json IS OLD.fiche_snapshot_json
  AND NEW.validated_by IS OLD.validated_by AND NEW.validated_at IS OLD.validated_at
  AND NEW.created_by = OLD.created_by AND NEW.created_at = OLD.created_at)
BEGIN SELECT RAISE(ABORT, 'Révision approuvée immuable : créer une nouvelle version.'); END;
CREATE TRIGGER protect_validated_plan BEFORE UPDATE OF pieces_json, sizes_json, input_json, product_id, category, usable_width_cm, matelas_length_cm, layers, gap_cm, marker_length_cm, coupe_table_id, roll_id, planned_start, planned_end, status ON marker_plans
WHEN OLD.status = 'valide'
BEGIN SELECT RAISE(ABORT, 'Plan validé immuable : créer une nouvelle version.'); END;
CREATE TRIGGER protect_validated_plan_delete BEFORE DELETE ON marker_plans WHEN OLD.status = 'valide'
BEGIN SELECT RAISE(ABORT, 'Historique du plan protégé.'); END;
