import type Database from 'better-sqlite3';
import { ServiceError } from '@/server/api/service-error';
import type { Actor } from '@/server/users/users-service';

/**
 * Aides communes au module Magasinier. Toutes les opérations sont
 * réservées au rôle chef_magasinier ; l'administrateur ne dispose pas
 * automatiquement des permissions métier (refus par défaut).
 */

export function requireMagasinier(actor: Actor): void {
  if (actor.roleCode !== 'chef_magasinier') {
    throw new ServiceError(
      'Seul un chef magasinier autorisé peut effectuer cette opération.',
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

export function toNumber(raw: unknown, label: string): number {
  const value = Number(String(raw ?? '').replace(',', '.'));
  if (!Number.isFinite(value)) {
    throw new ServiceError(`${label} doit être numérique.`, 400);
  }
  return value;
}

/** Historise une opération du module (écritures immuables). */
export function addMgHistory(
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
    `INSERT INTO mg_history
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
export function nextMgCode(
  db: Database.Database,
  table: string,
  prefix: string,
): string {
  const row = db
    .prepare(`SELECT COALESCE(MAX(id), 0) + 1 AS next FROM ${table}`)
    .get() as { next: number };
  return `${prefix}${String(row.next).padStart(6, '0')}`;
}

/**
 * Limites configurables des PDF, stockées dans app_meta (clés mg_*).
 * Valeurs par défaut raisonnables ; l'administrateur peut les ajuster.
 */
export function pdfLimits(db: Database.Database): {
  maxBytes: number;
  maxPages: number;
} {
  const read = (key: string, fallback: number): number => {
    const row = db.prepare('SELECT value FROM app_meta WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    const parsed = Number(row?.value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };
  return {
    maxBytes: read('mg_max_pdf_mb', 10) * 1024 * 1024,
    maxPages: read('mg_max_pdf_pages', 50),
  };
}
