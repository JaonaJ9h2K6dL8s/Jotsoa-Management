import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

/**
 * Connexion SQLite unique, réutilisée par tout le code serveur.
 * Le cache sur `globalThis` évite d'ouvrir plusieurs connexions
 * lors du rechargement à chaud (HMR) en développement.
 */

// Base existante de l'application (étape 1). Surcharge possible via
// la variable d'environnement DATABASE_PATH (voir .env.example).
const DEFAULT_DB_PATH = './data/jo-test-admin.db';

interface GlobalWithDb {
  __joManagementDb?: Database.Database;
}

export function getDatabasePath(): string {
  const configured = process.env.DATABASE_PATH ?? DEFAULT_DB_PATH;
  return path.resolve(process.cwd(), configured);
}

function openDatabase(dbPath: string): Database.Database {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const connection = new Database(dbPath);
  // WAL : lectures concurrentes non bloquantes pendant les écritures.
  connection.pragma('journal_mode = WAL');
  connection.pragma('foreign_keys = ON');
  connection.pragma('busy_timeout = 5000');
  return connection;
}

export function getDb(): Database.Database {
  const globalRef = globalThis as GlobalWithDb;
  if (globalRef.__joManagementDb) {
    return globalRef.__joManagementDb;
  }
  try {
    globalRef.__joManagementDb = openDatabase(getDatabasePath());
    return globalRef.__joManagementDb;
  } catch (cause) {
    throw new Error('Impossible d’ouvrir la base de données SQLite.', {
      cause,
    });
  }
}

export function closeDb(): void {
  const globalRef = globalThis as GlobalWithDb;
  if (globalRef.__joManagementDb) {
    globalRef.__joManagementDb.close();
    globalRef.__joManagementDb = undefined;
  }
}
