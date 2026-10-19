import type Database from 'better-sqlite3';
import { ServiceError } from '@/server/api/service-error';
import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import type { IdentifierType, LookupResultDTO } from '@/types/coupe';
import { LOT_STATUS_LABELS, ROLL_STATUS_LABELS } from '@/types/coupe';
import { addHistory, requireCoupe } from './common';

/**
 * Identifiants stables du module Coupe : codes manuels et payloads QR.
 * Le QR code identifie un enregistrement stable et ne remplace jamais
 * les données de la base ni les vérifications de permissions.
 */

export function qrPayloadFor(type: IdentifierType, code: string): string {
  return `JO|${type.toUpperCase()}|${code}`;
}

export function parseQrPayload(
  payload: string,
): { type: IdentifierType; code: string } | null {
  const parts = payload.split('|');
  if (parts.length !== 3 || parts[0] !== 'JO') return null;
  const type = parts[1].toLowerCase();
  if (type !== 'rouleau' && type !== 'lot' && type !== 'paquet') return null;
  return { type: type as IdentifierType, code: parts[2] };
}

export interface IdentifierInfo {
  code: string;
  qrPayload: string;
}

/** Crée l'identifiant stable d'un objet (dans la transaction appelante). */
export function createIdentifier(
  db: Database.Database,
  input: {
    objectType: IdentifierType;
    objectId: number;
    code: string;
    actorId: number | null;
  },
): IdentifierInfo {
  const payload = qrPayloadFor(input.objectType, input.code);
  try {
    db.prepare(
      `INSERT INTO coupe_identifiers
         (object_type, object_id, code, qr_payload, created_by)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(input.objectType, input.objectId, input.code, payload, input.actorId ?? 0);
  } catch {
    throw new ServiceError(
      `Le code « ${input.code} » est déjà utilisé pour un ${input.objectType}.`,
      409,
    );
  }
  return { code: input.code, qrPayload: payload };
}

export function getIdentifier(
  db: Database.Database,
  objectType: IdentifierType,
  objectId: number,
): IdentifierInfo | null {
  const row = db
    .prepare(
      'SELECT code, qr_payload FROM coupe_identifiers WHERE object_type = ? AND object_id = ?',
    )
    .get(objectType, objectId) as { code: string; qr_payload: string } | undefined;
  return row ? { code: row.code, qrPayload: row.qr_payload } : null;
}

interface IdentifierRow {
  id: number;
  object_type: IdentifierType;
  object_id: number;
  code: string;
}

/** Recherche par code manuel ou par payload QR (les deux mènent au même objet). */
export function lookupByCode(
  actor: Actor,
  code: string,
): LookupResultDTO {
  requireCoupe(actor);
  const db = sessionsDb();
  const cleaned = code.trim().toUpperCase();
  const byPayload = parseQrPayload(cleaned);
  const searchCode = byPayload ? byPayload.code : cleaned;
  const identifier = db
    .prepare('SELECT * FROM coupe_identifiers WHERE code = ?')
    .get(searchCode) as IdentifierRow | undefined;
  if (!identifier) {
    throw new ServiceError('Code inconnu : aucun enregistrement correspondant.', 404);
  }
  addHistory(db, {
    action: 'LOOKUP',
    entityType: `identifiant_${identifier.object_type}`,
    entityId: identifier.object_id,
    actorId: actor.id,
    newValue: { code: identifier.code },
  });
  return describeIdentifier(db, identifier);
}

function describeIdentifier(
  db: Database.Database,
  identifier: IdentifierRow,
): LookupResultDTO {
  if (identifier.object_type === 'rouleau') {
    const roll = db
      .prepare('SELECT code, status FROM coupe_rolls WHERE id = ?')
      .get(identifier.object_id) as
      | { code: string; status: keyof typeof ROLL_STATUS_LABELS }
      | undefined;
    if (!roll) throw new ServiceError('Rouleau introuvable.', 404);
    return {
      objectType: 'rouleau',
      objectId: identifier.object_id,
      code: roll.code,
      label: `Rouleau ${roll.code}`,
      statusLabel: ROLL_STATUS_LABELS[roll.status] ?? roll.status,
    };
  }
  if (identifier.object_type === 'lot') {
    const lot = db
      .prepare('SELECT code, status FROM coupe_lots WHERE id = ?')
      .get(identifier.object_id) as
      | { code: string; status: keyof typeof LOT_STATUS_LABELS }
      | undefined;
    if (!lot) throw new ServiceError('Lot introuvable.', 404);
    return {
      objectType: 'lot',
      objectId: identifier.object_id,
      code: lot.code,
      label: `Lot ${lot.code}`,
      statusLabel: LOT_STATUS_LABELS[lot.status] ?? lot.status,
    };
  }
  const bundle = db
    .prepare(
      `SELECT b.id, b.qty, s.nom AS size_nom, l.code AS lot_code
       FROM coupe_bundles b
       JOIN sizes s ON s.id = b.size_id
       JOIN coupe_lots l ON l.id = b.lot_id
       WHERE b.id = ?`,
    )
    .get(identifier.object_id) as
    | { id: number; qty: number; size_nom: string; lot_code: string }
    | undefined;
  if (!bundle) throw new ServiceError('Paquet introuvable.', 404);
  return {
    objectType: 'paquet',
    objectId: bundle.id,
    code: identifier.code,
    label: `Paquet ${bundle.lot_code} — ${bundle.size_nom} (${bundle.qty} pièces)`,
    statusLabel: 'Paquet de pièces coupées',
  };
}

/** Réimpression d'une étiquette : l'identifiant stable reste le même. */
export function reprintLabel(
  actor: Actor,
  objectType: IdentifierType,
  objectId: number,
): IdentifierInfo {
  requireCoupe(actor);
  const db = sessionsDb();
  const identifier = getIdentifier(db, objectType, objectId);
  if (!identifier) {
    throw new ServiceError('Aucun identifiant existant pour cet objet.', 404);
  }
  const apply = db.transaction(() => {
    db.prepare(
      `UPDATE coupe_identifiers
       SET reprint_count = reprint_count + 1, last_printed_at = datetime('now')
       WHERE object_type = ? AND object_id = ?`,
    ).run(objectType, objectId);
    addHistory(db, {
      action: 'REPRINT_LABEL',
      entityType: `identifiant_${objectType}`,
      entityId: objectId,
      actorId: actor.id,
      newValue: identifier,
    });
  });
  apply();
  return identifier;
}
