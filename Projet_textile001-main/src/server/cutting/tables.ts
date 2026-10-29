import type Database from 'better-sqlite3';
import { ServiceError } from '@/server/api/service-error';
import type { Actor } from '@/server/users/users-service';
import {
  assertCoupeAdmin,
  assertCoupeWrite,
  requireId,
  requirePositive,
} from './common';

/**
 * Les trois tables de coupe (§7) : ressources physiques partagées.
 * Lecture : chef de coupe (et consultation). Modification des
 * dimensions (largeur, longueur, largeur utile, couches) :
 * administrateur uniquement — c'est une configuration du logiciel.
 */

export interface TableItem {
  id: number;
  nom: string;
  largeurCm: number;
  longueurMaxCm: number;
  largeurUtileCm: number;
  couchesMax: number;
  isActive: boolean;
}

interface TableRow {
  id: number;
  nom: string;
  largeur_cm: number;
  longueur_max_cm: number;
  largeur_utile_cm: number;
  couches_max: number;
  is_active: number;
}

function toItem(row: TableRow): TableItem {
  return {
    id: row.id,
    nom: row.nom,
    largeurCm: row.largeur_cm,
    longueurMaxCm: row.longueur_max_cm,
    largeurUtileCm: row.largeur_utile_cm,
    couchesMax: row.couches_max,
    isActive: row.is_active === 1,
  };
}

export function listTables(db: Database.Database): TableItem[] {
  const rows = db
    .prepare(
      `SELECT id, nom, largeur_cm, longueur_max_cm, largeur_utile_cm,
              couches_max, is_active
         FROM coupe_tables
        ORDER BY nom`,
    )
    .all() as TableRow[];
  return rows.map(toItem);
}

export interface UpdateTableInput {
  tableId: number;
  largeurCm?: unknown;
  longueurMaxCm?: unknown;
  largeurUtileCm?: unknown;
  couchesMax?: unknown;
}

export function updateTable(
  db: Database.Database,
  actor: Actor,
  input: UpdateTableInput,
): TableItem {
  assertCoupeAdmin(actor);
  const tableId = requireId(input.tableId, 'La table');
  const row = db
    .prepare('SELECT * FROM coupe_tables WHERE id = ?')
    .get(tableId) as TableRow | undefined;
  if (!row) throw new ServiceError('Table de coupe introuvable.', 404);
  const largeur =
    input.largeurCm === undefined
      ? row.largeur_cm
      : requirePositive(input.largeurCm, 'La largeur de la table');
  const longueur =
    input.longueurMaxCm === undefined
      ? row.longueur_max_cm
      : requirePositive(input.longueurMaxCm, 'La longueur de la table');
  const utile =
    input.largeurUtileCm === undefined
      ? row.largeur_utile_cm
      : requirePositive(input.largeurUtileCm, 'La largeur utile');
  if (utile > largeur) {
    throw new ServiceError(
      'La largeur utile ne peut pas dépasser la largeur de la table.',
      400,
    );
  }
  const couches =
    input.couchesMax === undefined
      ? row.couches_max
      : requirePositive(input.couchesMax, 'Le nombre de couches');
  db.prepare(
    `UPDATE coupe_tables
        SET largeur_cm = ?, longueur_max_cm = ?, largeur_utile_cm = ?,
            couches_max = ?, updated_at = datetime('now')
      WHERE id = ?`,
  ).run(largeur, longueur, utile, couches, tableId);
  const updated = db
    .prepare('SELECT * FROM coupe_tables WHERE id = ?')
    .get(tableId) as TableRow;
  return toItem(updated);
}

/** Vérifie l'existence d'une table active ; utilisé par les plans. */
export function requireActiveTable(
  db: Database.Database,
  tableId: number,
): TableItem {
  const row = db
    .prepare('SELECT * FROM coupe_tables WHERE id = ? AND is_active = 1')
    .get(tableId) as TableRow | undefined;
  if (!row) {
    throw new ServiceError('Table de coupe introuvable ou inactive.', 404);
  }
  return toItem(row);
}

/** Garde-fou : lecture des tables réservée au personnel du module. */
export function assertCanConsult(actor: Actor): void {
  assertCoupeWrite(actor);
}
