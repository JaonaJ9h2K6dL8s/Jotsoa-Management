import { ServiceError } from '@/server/api/service-error';
import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import {
  addHistory,
  nextCode,
  requireCoupe,
  requireId,
} from './common';
import { createIdentifier } from './identifiers';

/**
 * Paquets de pièces coupées : identification par code + QR, rattachés
 * à un lot et à une taille. Le contenu d'un paquet ne change jamais
 * silencieusement : toute correction passe par une opération historisée.
 */

export function createBundle(
  actor: Actor,
  input: Record<string, unknown>,
): { id: number; code: string; qrPayload: string; qty: number } {
  requireCoupe(actor);
  const db = sessionsDb();
  const lotId = requireId(input.lotId, 'Lot');
  const sizeId = requireId(input.sizeId, 'Taille');
  const qty = Number(String(input.qty ?? '').replace(',', '.'));
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new ServiceError('La quantité du paquet doit être supérieure à 0.', 400);
  }
  const lot = db
    .prepare('SELECT id, status FROM coupe_lots WHERE id = ?')
    .get(lotId) as { id: number; status: string } | undefined;
  if (!lot) throw new ServiceError('Lot introuvable.', 404);
  if (lot.status === 'transfere' || lot.status === 'annule') {
    throw new ServiceError(
      'Aucun paquet ne peut être créé sur un lot transféré ou annulé.', 409,
    );
  }
  const sizeInLot = db
    .prepare('SELECT id FROM coupe_lot_sizes WHERE lot_id = ? AND size_id = ?')
    .get(lotId, sizeId) as { id: number } | undefined;
  if (!sizeInLot) {
    throw new ServiceError(
      'La taille choisie ne fait pas partie des tailles du lot.', 400,
    );
  }
  const insert = db.transaction(() => {
    const code = nextCode(db, 'coupe_bundles', 'PKG-');
    const result = db
      .prepare(
        `INSERT INTO coupe_bundles (lot_id, size_id, qty, created_by)
         VALUES (?, ?, ?, ?)`,
      )
      .run(lotId, sizeId, qty, actor.id);
    const id = Number(result.lastInsertRowid);
    const identifier = createIdentifier(db, {
      objectType: 'paquet',
      objectId: id,
      code,
      actorId: actor.id,
    });
    addHistory(db, {
      action: 'BUNDLE_CREATED',
      entityType: 'paquet',
      entityId: id,
      actorId: actor.id,
      newValue: { lotId, sizeId, qty, code },
    });
    return { id, ...identifier, qty };
  });
  return insert();
}
