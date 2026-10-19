import type Database from 'better-sqlite3';
import { ServiceError } from '@/server/api/service-error';
import type { Actor } from '@/server/users/users-service';

/**
 * Aides communes aux services du module Coupe.
 * Toutes les opérations métier sont réservées au rôle chef_coupe :
 * l'administrateur ne dispose pas automatiquement des permissions
 * métier — celles-ci doivent être explicitement définies.
 */

export function requireCoupe(actor: Actor): void {
  if (actor.roleCode !== 'chef_coupe') {
    throw new ServiceError(
      'Seul un chef de coupe autorisé peut effectuer cette opération.',
      403,
    );
  }
}

/** Convertit un identifiant reçu en entier positif, sinon erreur 400. */
export function requireId(raw: unknown, label: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new ServiceError(`${label} invalide.`, 400);
  }
  return value;
}

/** Historise une opération du module Coupe (jamais modifiable ni supprimable). */
export function addHistory(
  db: Database.Database,
  input: {
    action: string;
    entityType: string;
    entityId: number;
    actorId: number | null;
    oldValue?: unknown;
    newValue?: unknown;
    reason?: string | null;
  },
): void {
  db.prepare(
    `INSERT INTO coupe_history
       (action, entity_type, entity_id, actor_id, old_value, new_value, reason)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.action,
    input.entityType,
    input.entityId,
    input.actorId ?? 0,
    input.oldValue === undefined ? null : JSON.stringify(input.oldValue),
    input.newValue === undefined ? null : JSON.stringify(input.newValue),
    input.reason ?? null,
  );
}

/** Génère un code séquentiel préfixé (RO-, LOT-, TC-…) pour une table. */
export function nextCode(
  db: Database.Database,
  table: string,
  prefix: string,
): string {
  const row = db
    .prepare(`SELECT COALESCE(MAX(id), 0) + 1 AS next FROM ${table}`)
    .get() as { next: number };
  return `${prefix}${String(row.next).padStart(6, '0')}`;
}

export interface IdRef {
  id: number;
  nom: string;
}

/** Vérifie qu'une référence de configuration existe et est active. */
export function requireActiveRef(
  db: Database.Database,
  table: string,
  id: number,
  label: string,
): IdRef {
  const row = db
    .prepare(`SELECT id, nom FROM ${table} WHERE id = ? AND is_active = 1`)
    .get(id) as IdRef | undefined;
  if (!row) {
    throw new ServiceError(
      `${label} sélectionné(e) est introuvable ou désactivé(e).`,
      400,
    );
  }
  return row;
}

export function normalizeText(raw: unknown, max: number): string | null {
  if (raw === null || raw === undefined) return null;
  const value = String(raw).trim();
  if (!value) return null;
  if (value.length > max) {
    throw new ServiceError(`Le texte ne doit pas dépasser ${max} caractères.`, 400);
  }
  return value;
}
