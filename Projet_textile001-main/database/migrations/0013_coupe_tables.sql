-- Tables de coupe (cahier §7) : ressources indépendantes, jamais
-- additionnées. Largeur utile et couches max configurables.
CREATE TABLE IF NOT EXISTS coupe_tables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nom TEXT NOT NULL UNIQUE,
  largeur_cm REAL NOT NULL,
  longueur_max_cm REAL NOT NULL,
  largeur_utile_cm REAL NOT NULL,
  couches_max INTEGER NOT NULL DEFAULT 12,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Configuration initiale du cahier des charges (§7) : largeur 2,8 m ;
-- longueurs max 10 m / 8 m / 5 m. Largeur utile indicative (réglable),
-- couches max indicatives (réglables) — §8.
INSERT INTO coupe_tables (nom, largeur_cm, longueur_max_cm, largeur_utile_cm, couches_max)
SELECT 'Table 1', 280, 1000, 275, 12
WHERE NOT EXISTS (SELECT 1 FROM coupe_tables WHERE nom = 'Table 1');

INSERT INTO coupe_tables (nom, largeur_cm, longueur_max_cm, largeur_utile_cm, couches_max)
SELECT 'Table 2', 280, 800, 275, 12
WHERE NOT EXISTS (SELECT 1 FROM coupe_tables WHERE nom = 'Table 2');

INSERT INTO coupe_tables (nom, largeur_cm, longueur_max_cm, largeur_utile_cm, couches_max)
SELECT 'Table 3', 280, 500, 275, 10
WHERE NOT EXISTS (SELECT 1 FROM coupe_tables WHERE nom = 'Table 3');

-- Rattachement facultatif d'un plan de marker à sa table de coupe.
ALTER TABLE marker_plans ADD COLUMN coupe_table_id INTEGER REFERENCES coupe_tables(id);
