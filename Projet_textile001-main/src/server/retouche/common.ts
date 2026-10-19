import type Database from 'better-sqlite3';
import { ServiceError } from '@/server/api/service-error';
import type { Actor } from '@/server/users/users-service';

/**
 * Aides communes au module Retouche. Toutes les opérations métier sont
 * réservées au rôle retoucheur ; l'administrateur ne dispose pas
 * automatiquement des permissions métier.
 */

export function requireRetouche(actor: Actor): void {
  if (actor.roleCode !== 'retoucheur') {
    throw new ServiceError(
      'Seul un retoucheur autorisé peut effectuer cette opération.',
      403,
    );
  }
}

/** La décision finale des propositions de rebut appartient au CQ. */
export function requireCqDecision(actor: Actor): void {
  if (actor.roleCode !== 'controleur_qualite') {
    throw new ServiceError(
      'Seul le Contrôle qualité peut statuer sur une proposition de rebut.',
      403,
    );
  }
}

/** Consultation des propositions de rebut : retoucheur ou CQ. */
export function requireRetoucheOrCq(actor: Actor): void {
  if (actor.roleCode !== 'retoucheur' && actor.roleCode !== 'controleur_qualite') {
    throw new ServiceError(
      'Seuls le retoucheur et le Contrôle qualité peuvent consulter les propositions de rebut.',
      403,
    );
  }
}

export function requireId(raw: unknown, label: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new ServiceError(`${label} invalide.`, 400);
  }
  return value;
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

export function toNumber(raw: unknown, label: string): number {
  const value = Number(String(raw ?? '').replace(',', '.'));
  if (!Number.isFinite(value)) {
    throw new ServiceError(`${label} doit être numérique.`, 400);
  }
  return value;
}

/** Historise une opération du module Retouche (écritures immuables). */
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
    `INSERT INTO rt_history
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

/** Génère un code séquentiel préfixé pour une table du module. */
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
