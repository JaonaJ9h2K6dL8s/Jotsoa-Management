-- Migration 0002 : authentification, sessions et journal d'audit.
-- Recrée le schéma appliqué à data/jo-test-admin.db (idempotent grâce
-- à IF NOT EXISTS) afin que toute base neuve obtenne la même structure.

CREATE TABLE IF NOT EXISTS roles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT    NOT NULL UNIQUE,
  nom         TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  nom                  TEXT    NOT NULL,
  prenom               TEXT,
  username             TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  password_hash        TEXT    NOT NULL,
  role_id              INTEGER NOT NULL REFERENCES roles(id),
  is_active            INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1)),
  created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT    NOT NULL DEFAULT (datetime('now')),
  last_login_at        TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT    NOT NULL UNIQUE,
  expires_at   TEXT    NOT NULL,
  created_at   TEXT    NOT NULL,
  last_seen_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action         TEXT    NOT NULL,
  target_user_id INTEGER,
  details        TEXT    NOT NULL DEFAULT '',
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_role         ON users(role_id);
CREATE INDEX IF NOT EXISTS idx_users_active       ON users(is_active);
CREATE INDEX IF NOT EXISTS idx_sessions_user      ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires   ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_audit_created      ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_actor        ON audit_logs(actor_user_id);

-- Les huit rôles métier initiaux. INSERT OR IGNORE : aucun doublon
-- même si la migration est rejouée sur une base partielle.
INSERT OR IGNORE INTO roles (code, nom, description) VALUES
  ('admin',              'Administrateur',      'Administration globale de l''application.'),
  ('chef_coupe',         'Chef de coupe',       'Gestion de la coupe.'),
  ('chef_couture',       'Chef de couture',     'Gestion de la couture.'),
  ('controleur_qualite', 'Contrôleur qualité',  'Contrôle des produits.'),
  ('retoucheur',         'Retoucheur',          'Correction des défauts.'),
  ('chef_stock',         'Chef de stock',       'Gestion du stock et des cartons.'),
  ('chef_magasinier',    'Chef magasinier',     'Préparation et sorties magasin.'),
  ('chef_securite',      'Chef sécurité',       'Vérification des sorties.');
