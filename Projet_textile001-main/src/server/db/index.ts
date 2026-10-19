import type Database from 'better-sqlite3';
import { getDb } from './connection';
import { runMigrations } from './migrate';

/**
 * Point d'entrée unique de la couche données.
 * Les composants React n'importent jamais ce module :
 * seuls les routes API et services serveur y ont accès.
 */

let initialized = false;

export function initDatabase(): Database.Database {
  const db = getDb();
  if (!initialized) {
    runMigrations(db);
    initialized = true;
  }
  return db;
}

export { getDb, closeDb, getDatabasePath } from './connection';
export { runMigrations, listAppliedMigrations } from './migrate';
