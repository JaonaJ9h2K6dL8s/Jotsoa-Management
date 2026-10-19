-- Migration 0011 : catalogue produits organisé par catégories (6 familles).
-- Non destructive : les anciens types génériques sont conservés mais
-- désactivés ; les produits initiaux sont insérés une seule fois.

-- 1) Ordre d'affichage des catégories de produits.
ALTER TABLE product_types ADD COLUMN display_order INTEGER NOT NULL DEFAULT 100;

-- 2) Anciens types génériques (étape 3) : conservés, désactivés.
UPDATE product_types SET is_active = 0, display_order = 100
WHERE nom IN ('T-shirt', 'Polo', 'Short', 'Pantalon', 'Jogging');

-- 3) Six catégories actives du catalogue.
INSERT OR IGNORE INTO product_types (nom, description, is_active, display_order) VALUES
  ('Matières premières', 'Tissus, fils et accessoires entrant dans la fabrication.', 1, 1),
  ('Vêtements pour enfants', 'Vêtements destinés aux enfants.', 1, 2),
  ('Vêtements pour adultes', 'Vêtements destinés aux adultes.', 1, 3),
  ('Produits semi-finis', 'Pièces découpées et vêtements en cours de production.', 1, 4),
  ('Produits finis et conditionnement', 'Vêtements conformes, emballés et prêts à être expédiés.', 1, 5),
  ('Déchets et sous-produits textiles', 'Chutes, résidus et rebuts valorisables.', 1, 6);

-- 4) Produits initiaux — Matières premières.
INSERT INTO products (nom, description, product_type_id)
  SELECT v.nom, '', t.id FROM (
    SELECT 'Tissu en coton' AS nom
    UNION ALL SELECT 'Tissu polyester'
    UNION ALL SELECT 'Jersey'
    UNION ALL SELECT 'Tissu molletonné'
    UNION ALL SELECT 'Denim (jean)'
    UNION ALL SELECT 'Fil à coudre'
    UNION ALL SELECT 'Élastique, boutons et fermetures éclair'
  ) v
  JOIN product_types t ON t.nom = 'Matières premières'
  WHERE NOT EXISTS (
    SELECT 1 FROM products p
    WHERE p.product_type_id = t.id AND LOWER(TRIM(p.nom)) = LOWER(TRIM(v.nom))
  );

-- 5) Produits initiaux — Vêtements pour enfants.
INSERT INTO products (nom, description, product_type_id)
  SELECT v.nom, '', t.id FROM (
    SELECT 'Ensemble short + T-shirt' AS nom
    UNION ALL SELECT 'Ensemble pantalon + T-shirt'
    UNION ALL SELECT 'Pyjama enfant'
    UNION ALL SELECT 'Robe enfant'
    UNION ALL SELECT 'Short'
    UNION ALL SELECT 'Pantalon'
    UNION ALL SELECT 'T-shirt'
    UNION ALL SELECT 'Sweat-shirt et veste'
  ) v
  JOIN product_types t ON t.nom = 'Vêtements pour enfants'
  WHERE NOT EXISTS (
    SELECT 1 FROM products p
    WHERE p.product_type_id = t.id AND LOWER(TRIM(p.nom)) = LOWER(TRIM(v.nom))
  );

-- 6) Produits initiaux — Vêtements pour adultes.
INSERT INTO products (nom, description, product_type_id)
  SELECT v.nom, '', t.id FROM (
    SELECT 'T-shirt' AS nom
    UNION ALL SELECT 'Polo'
    UNION ALL SELECT 'Ensemble short + T-shirt'
    UNION ALL SELECT 'Ensemble jogging'
    UNION ALL SELECT 'Pantalon'
    UNION ALL SELECT 'Chemise'
    UNION ALL SELECT 'Robe'
    UNION ALL SELECT 'Jupe'
    UNION ALL SELECT 'Veste et sweat-shirt'
  ) v
  JOIN product_types t ON t.nom = 'Vêtements pour adultes'
  WHERE NOT EXISTS (
    SELECT 1 FROM products p
    WHERE p.product_type_id = t.id AND LOWER(TRIM(p.nom)) = LOWER(TRIM(v.nom))
  );

-- 7) Produits initiaux — Produits semi-finis.
INSERT INTO products (nom, description, product_type_id)
  SELECT v.nom, '', t.id FROM (
    SELECT 'Pièces de tissu découpées' AS nom
    UNION ALL SELECT 'Devants et dos de T-shirts'
    UNION ALL SELECT 'Manches'
    UNION ALL SELECT 'Shorts découpés'
    UNION ALL SELECT 'Vêtements en cours de couture'
    UNION ALL SELECT 'Vêtements en attente de contrôle'
    UNION ALL SELECT 'Vêtements en retouche'
  ) v
  JOIN product_types t ON t.nom = 'Produits semi-finis'
  WHERE NOT EXISTS (
    SELECT 1 FROM products p
    WHERE p.product_type_id = t.id AND LOWER(TRIM(p.nom)) = LOWER(TRIM(v.nom))
  );

-- 8) Produits initiaux — Produits finis et conditionnement.
INSERT INTO products (nom, description, product_type_id)
  SELECT v.nom, '', t.id FROM (
    SELECT 'Vêtements conformes' AS nom
    UNION ALL SELECT 'Vêtements emballés'
    UNION ALL SELECT 'Lots de vêtements'
    UNION ALL SELECT 'Cartons de vêtements'
    UNION ALL SELECT 'Produits prêts à être expédiés'
  ) v
  JOIN product_types t ON t.nom = 'Produits finis et conditionnement'
  WHERE NOT EXISTS (
    SELECT 1 FROM products p
    WHERE p.product_type_id = t.id AND LOWER(TRIM(p.nom)) = LOWER(TRIM(v.nom))
  );

-- 9) Produits initiaux — Déchets et sous-produits textiles.
INSERT INTO products (nom, description, product_type_id)
  SELECT v.nom, '', t.id FROM (
    SELECT 'Chutes de tissu' AS nom
    UNION ALL SELECT 'Petits morceaux de tissu'
    UNION ALL SELECT 'Fils et résidus'
    UNION ALL SELECT 'Chutes triées pour la revente ou le recyclage'
  ) v
  JOIN product_types t ON t.nom = 'Déchets et sous-produits textiles'
  WHERE NOT EXISTS (
    SELECT 1 FROM products p
    WHERE p.product_type_id = t.id AND LOWER(TRIM(p.nom)) = LOWER(TRIM(v.nom))
  );
