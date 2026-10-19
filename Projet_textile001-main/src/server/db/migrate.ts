import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';

/**
 * Mécanisme de migrations incrémentales.
 * Chaque fichier `database/migrations/NNNN_nom.sql` est appliqué une seule
 * fois, dans l'ordre alphabétique, à l'intérieur d'une transaction.
 * Aucune migration n'est jamais ré-appliquée ni supprimée.
 */

const MIGRATIONS_DIR = path.resolve(process.cwd(), 'database/migrations');

interface MigrationRow {
  id: string;
}

function ensureMigrationsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

export function listMigrationFiles(): string[] {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    return [];
  }
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();
}

export function listAppliedMigrations(db: Database.Database): string[] {
  ensureMigrationsTable(db);
  const rows = db
    .prepare('SELECT id FROM schema_migrations ORDER BY id')
    .all() as MigrationRow[];
  return rows.map((row) => row.id);
}

export function runMigrations(db: Database.Database): string[] {
  ensureMigrationsTable(db);
  const applied = new Set(listAppliedMigrations(db));
  const pending = listMigrationFiles().filter((file) => !applied.has(file));

  // Les reconstructions de tables (ALTER de contraintes CHECK) exigent
  // que les clés étrangères soient désactivées pendant la migration ;
  // le pragma est rétabli après, hors transaction.
  db.pragma('foreign_keys = OFF');
  try {
    for (const file of pending) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      const applyOne = db.transaction(() => {
        db.exec(sql);
        db.prepare('INSERT INTO schema_migrations (id) VALUES (?)').run(file);
      });
      try {
        applyOne();
      } catch (cause) {
        throw new Error(`Échec de la migration ${file}.`, { cause });
      }
    }
  } finally {
    db.pragma('foreign_keys = ON');
  }

  return pending;
}
