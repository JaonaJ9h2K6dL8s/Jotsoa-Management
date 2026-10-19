-- Migration 0001 : métadonnées applicatives.
-- Les tables métier (utilisateurs, coupe, couture, stock, etc.)
-- seront ajoutées par des migrations dédiées dans les étapes suivantes.

CREATE TABLE IF NOT EXISTS app_meta (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO app_meta (key, value) VALUES ('app_name', 'JO Management');
INSERT OR IGNORE INTO app_meta (key, value) VALUES ('schema_baseline', '0001');
