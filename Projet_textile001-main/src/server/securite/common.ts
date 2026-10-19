import type Database from 'better-sqlite3';
import { ServiceError } from '@/server/api/service-error';
import type { Actor } from '@/server/users/users-service';
import type { SecControlLevel } from '@/types/securite';

/**
 * Aides communes au module Sécurité. Toutes les opérations sont
 * réservées au rôle chef_securite ; l'administrateur ne dispose pas
 * automatiquement des permissions métier (refus par défaut).
 */

export function requireSecurite(actor: Actor): void {
  if (actor.roleCode !== 'chef_securite') {
    throw new ServiceError(
      'Seul un chef de la sécurité autorisé peut effectuer cette opération.',
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

export function requireText(raw: unknown, label: string, max: number): string {
  const value = normalizeText(raw, max);
  if (!value) throw new ServiceError(`${label} est obligatoire.`, 400);
  return value;
}

/** Historise une opération du module (écritures immuables). */
export function addSecHistory(
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
    `INSERT INTO sec_history
       (action, entity_type, entity_id, actor_id, old_value, new_value, reason)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.action,
    input.entityType,
    input.entityId,
    input.actorId,
    input.oldValue === undefined ? null : JSON.stringify(input.oldValue),
    input.newValue === undefined ? null : JSON.stringify(input.newValue),
    input.reason ?? null,
  );
}

/** Code séquentiel préfixé pour une table du module. */
export function nextSecCode(
  db: Database.Database,
  table: string,
  prefix: string,
): string {
  const row = db
    .prepare(`SELECT COALESCE(MAX(id), 0) + 1 AS next FROM ${table}`)
    .get() as { next: number };
  return `${prefix}${String(row.next).padStart(6, '0')}`;
}

const LEVEL_STRENGTH: Record<SecControlLevel, number> = {
  cartons: 1,
  references: 2,
  quantites: 3,
};

/** Niveau par défaut configuré (app_meta sec_default_level). */
export function defaultLevel(db: Database.Database): SecControlLevel {
  const row = db
    .prepare('SELECT value FROM app_meta WHERE key = ?')
    .get('sec_default_level') as { value: string } | undefined;
  const value = row?.value as SecControlLevel | undefined;
  return value && value in LEVEL_STRENGTH ? value : 'cartons';
}

/** Le niveau demandé ne peut jamais être inférieur au niveau configuré. */
export function resolveLevel(
  db: Database.Database,
  requested: unknown,
): SecControlLevel {
  const fallback = defaultLevel(db);
  if (requested === undefined || requested === null || requested === '') {
    return fallback;
  }
  const value = String(requested) as SecControlLevel;
  if (!(value in LEVEL_STRENGTH)) {
    throw new ServiceError('Niveau de contrôle inconnu.', 400);
  }
  if (LEVEL_STRENGTH[value] < LEVEL_STRENGTH[fallback]) {
    throw new ServiceError(
      `Le niveau de contrôle ne peut pas être réduit : minimum configuré « ${fallback} ».`,
      409,
    );
  }
  return value;
}

/**
 * Extrait le code de carton d'un payload QR (JO|CARTON|CODE) ou d'une
 * saisie manuelle. Un payload invalide lève qr_invalide.
 */
export function parseCartonCode(raw: string): { code: string; fromQr: boolean } {
  const value = raw.trim();
  if (value.startsWith('JO|CARTON|')) {
    const code = value.slice('JO|CARTON|'.length).trim();
    if (!code) {
      throw new ServiceError('QR code invalide : code de carton absent.', 400);
    }
    return { code, fromQr: true };
  }
  if (!value || value.length > 60) {
    throw new ServiceError('Code de carton invalide.', 400);
  }
  return { code: value, fromQr: false };
}
