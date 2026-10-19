-- Migration 0007 : module Retouche (étape 7).
-- Non destructive : création de tables et index uniquement.
-- Les demandes de retouche restent dans cq_rework_requests (étape 6) :
-- la Retouche ne duplique pas cette table, elle la consomme et trace
-- son propre cycle (réception, affectation, interventions, retours,
-- propositions de rebut) dans des tables rt_*.

CREATE TABLE IF NOT EXISTS rt_receptions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id  INTEGER NOT NULL UNIQUE REFERENCES cq_rework_requests(id),
  received_by INTEGER NOT NULL REFERENCES users(id),
  notes       TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rt_reception_lines (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  reception_id INTEGER NOT NULL REFERENCES rt_receptions(id),
  size_id      INTEGER NOT NULL REFERENCES sizes(id),
  requested_qty REAL   NOT NULL CHECK (requested_qty > 0),
  received_qty  REAL   NOT NULL CHECK (received_qty >= 0),
  UNIQUE (reception_id, size_id)
);

CREATE TABLE IF NOT EXISTS rt_assignments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT    NOT NULL UNIQUE,
  request_id    INTEGER NOT NULL REFERENCES cq_rework_requests(id),
  retoucheur_id INTEGER NOT NULL REFERENCES users(id),
  assigned_by   INTEGER NOT NULL REFERENCES users(id),
  status        TEXT    NOT NULL DEFAULT 'affectee'
                CHECK (status IN ('affectee','en_cours','terminee','annulee')),
  notes         TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rt_assignment_lines (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id INTEGER NOT NULL REFERENCES rt_assignments(id),
  size_id       INTEGER NOT NULL REFERENCES sizes(id),
  qty           REAL    NOT NULL CHECK (qty > 0),
  UNIQUE (assignment_id, size_id)
);

CREATE TABLE IF NOT EXISTS rt_interventions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT    NOT NULL UNIQUE,
  assignment_id INTEGER NOT NULL REFERENCES rt_assignments(id),
  retoucheur_id INTEGER NOT NULL REFERENCES users(id),
  status        TEXT    NOT NULL DEFAULT 'en_cours'
                CHECK (status IN ('en_cours','terminee','annulee')),
  action        TEXT,
  notes         TEXT,
  started_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  ended_at      TEXT
);

CREATE TABLE IF NOT EXISTS rt_intervention_lines (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  intervention_id INTEGER NOT NULL REFERENCES rt_interventions(id),
  size_id         INTEGER NOT NULL REFERENCES sizes(id),
  processed_qty   REAL    NOT NULL CHECK (processed_qty >= 0),
  result          TEXT    NOT NULL CHECK (result IN ('repare','irreparable','partiel')),
  UNIQUE (intervention_id, size_id)
);

CREATE TABLE IF NOT EXISTS rt_returns (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT    NOT NULL UNIQUE,
  request_id  INTEGER NOT NULL REFERENCES cq_rework_requests(id),
  returned_by INTEGER NOT NULL REFERENCES users(id),
  status      TEXT    NOT NULL DEFAULT 'transmis'
              CHECK (status IN ('transmis','annule')),
  notes       TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rt_return_lines (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  return_id INTEGER NOT NULL REFERENCES rt_returns(id),
  size_id   INTEGER NOT NULL REFERENCES sizes(id),
  qty       REAL    NOT NULL CHECK (qty > 0),
  UNIQUE (return_id, size_id)
);

CREATE TABLE IF NOT EXISTS rt_rebut_proposals (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  code          TEXT    NOT NULL UNIQUE,
  request_id    INTEGER NOT NULL REFERENCES cq_rework_requests(id),
  retoucheur_id INTEGER NOT NULL REFERENCES users(id),
  size_id       INTEGER NOT NULL REFERENCES sizes(id),
  qty           REAL    NOT NULL CHECK (qty > 0),
  motif         TEXT    NOT NULL,
  status        TEXT    NOT NULL DEFAULT 'en_attente'
                CHECK (status IN ('en_attente','approuvee','refusee')),
  decided_by    INTEGER REFERENCES users(id),
  decided_at    TEXT,
  decision_note TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rt_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  action      TEXT    NOT NULL,
  entity_type TEXT    NOT NULL,
  entity_id   INTEGER NOT NULL,
  actor_id    INTEGER NOT NULL,
  old_value   TEXT,
  new_value   TEXT,
  reason      TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rt_assignments_request
  ON rt_assignments(request_id);
CREATE INDEX IF NOT EXISTS idx_rt_interventions_assignment
  ON rt_interventions(assignment_id);
CREATE INDEX IF NOT EXISTS idx_rt_returns_request
  ON rt_returns(request_id);
CREATE INDEX IF NOT EXISTS idx_rt_history_entity
  ON rt_history(entity_type, entity_id);
