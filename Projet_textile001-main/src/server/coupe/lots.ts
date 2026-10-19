import { ServiceError } from '@/server/api/service-error';
import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import type { LotDTO, LotDetailDTO, LotStatus } from '@/types/coupe';
import { normalizeCode, validateCode } from '@/lib/coupe-validation';
import {
  addHistory,
  normalizeText,
  nextCode,
  requireActiveRef,
  requireCoupe,
  requireId,
} from './common';
import { LOT_SELECT, loadLotDetail, mapLot, type LotDbRow } from './lot-queries';

/**
 * Écritures des lots de coupe : création avec tailles et quantités
 * variables, transitions de statut contrôlées.
 * Les quantités prévues ne sont jamais considérées comme produites.
 */

interface SizeInput {
  sizeId: number;
  plannedQty: number;
}

function parseSizeInputs(
  db: ReturnType<typeof sessionsDb>,
  raw: unknown,
): SizeInput[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ServiceError(
      'Au moins une taille avec une quantité prévue est requise.',
      400,
    );
  }
  const seen = new Set<number>();
  const sizes: SizeInput[] = [];
  for (const entry of raw) {
    const record = entry as Record<string, unknown>;
    const sizeId = requireId(record.sizeId, 'Taille');
    if (seen.has(sizeId)) {
      throw new ServiceError(
        'Chaque taille ne peut apparaître qu’une fois.',
        400,
      );
    }
    seen.add(sizeId);
    requireActiveRef(db, 'sizes', sizeId, 'La taille');
    const plannedQty = Number(record.plannedQty);
    if (!Number.isFinite(plannedQty) || plannedQty <= 0) {
      throw new ServiceError(
        'Chaque quantité prévue doit être supérieure à 0.',
        400,
      );
    }
    sizes.push({ sizeId, plannedQty });
  }
  return sizes;
}

export function createLot(
  actor: Actor,
  input: Record<string, unknown>,
): LotDetailDTO {
  requireCoupe(actor);
  const db = sessionsDb();
  const productId = requireId(input.productId, 'Produit');
  requireActiveRef(db, 'products', productId, 'Le produit');
  const colorId = requireId(input.colorId, 'Couleur');
  requireActiveRef(db, 'colors', colorId, 'La couleur');
  const sizes = parseSizeInputs(db, input.sizes);
  const notes = normalizeText(input.notes, 500);
  let code = '';
  if (input.code) {
    const codeError = validateCode(input.code, 'Le code du lot');
    if (codeError) throw new ServiceError(codeError, 400);
    code = normalizeCode(input.code);
    const existing = db
      .prepare('SELECT id FROM coupe_lots WHERE code = ?')
      .get(code) as { id: number } | undefined;
    if (existing) {
      throw new ServiceError(`Le code lot « ${code} » est déjà utilisé.`, 409);
    }
  }
  const insert = db.transaction(() => {
    if (!code) code = nextCode(db, 'coupe_lots', 'LOT-');
    const total = sizes.reduce((sum, size) => sum + size.plannedQty, 0);
    const result = db
      .prepare(
        `INSERT INTO coupe_lots
           (code, product_id, color_id, total_planned_qty, status, responsable_id, notes)
         VALUES (?, ?, ?, ?, 'brouillon', ?, ?)`,
      )
      .run(code, productId, colorId, total, actor.id, notes);
    const lotId = Number(result.lastInsertRowid);
    for (const size of sizes) {
      db.prepare(
        'INSERT INTO coupe_lot_sizes (lot_id, size_id, planned_qty) VALUES (?, ?, ?)',
      ).run(lotId, size.sizeId, size.plannedQty);
    }
    addHistory(db, {
      action: 'LOT_CREATED',
      entityType: 'lot',
      entityId: lotId,
      actorId: actor.id,
      newValue: { code, productId, colorId, totalPlannedQty: total },
    });
    return lotId;
  });
  const lotId = insert();
  return loadLotDetail(actor, lotId);
}

export function listLots(
  actor: Actor,
  filters: { search?: string; status?: string } = {},
): LotDTO[] {
  requireCoupe(actor);
  const db = sessionsDb();
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filters.search?.trim()) {
    clauses.push('(LOWER(l.code) LIKE ? OR LOWER(p.nom) LIKE ?)');
    const term = `%${filters.search.trim().toLowerCase()}%`;
    params.push(term, term);
  }
  if (filters.status) {
    clauses.push('l.status = ?');
    params.push(filters.status);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare(`${LOT_SELECT} ${where} ORDER BY l.id DESC`)
    .all(...params) as LotDbRow[];
  return rows.map(mapLot);
}

/**
 * Transitions de statut contrôlées côté serveur. Le passage direct à
 * « transfere » est interdit : seul le service de transfert peut le faire,
 * après vérification complète dans une transaction.
 */
export function patchLot(
  actor: Actor,
  rawId: unknown,
  input: Record<string, unknown>,
): LotDetailDTO {
  requireCoupe(actor);
  const id = requireId(rawId, 'Identifiant du lot');
  const db = sessionsDb();
  const lot = db.prepare('SELECT * FROM coupe_lots WHERE id = ?').get(id) as
    | { id: number; code: string; status: LotStatus }
    | undefined;
  if (!lot) throw new ServiceError('Lot introuvable.', 404);
  const action = String(input.action ?? '');
  const reason = normalizeText(input.reason, 300);
  const apply = db.transaction(() => {
    if (action === 'start') {
      if (lot.status !== 'brouillon') {
        throw new ServiceError(
          'Seul un lot en brouillon peut démarrer sa coupe.',
          409,
        );
      }
      db.prepare(
        "UPDATE coupe_lots SET status = 'en_coupe', started_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
      ).run(id);
    } else if (action === 'set_attente') {
      if (lot.status !== 'en_coupe') {
        throw new ServiceError(
          'Seul un lot en cours peut passer en attente de validation.',
          409,
        );
      }
      db.prepare(
        "UPDATE coupe_lots SET status = 'resultat_a_confirmer', updated_at = datetime('now') WHERE id = ?",
      ).run(id);
    } else if (action === 'resume') {
      if (lot.status !== 'resultat_a_confirmer') {
        throw new ServiceError(
          'Ce lot n’est pas en attente de validation.',
          409,
        );
      }
      db.prepare(
        "UPDATE coupe_lots SET status = 'en_coupe', updated_at = datetime('now') WHERE id = ?",
      ).run(id);
    } else if (action === 'block') {
      if (
        !['en_coupe', 'resultat_a_confirmer', 'pret_transfert'].includes(lot.status)
      ) {
        throw new ServiceError(
          'Ce lot ne peut pas être bloqué dans son état actuel.',
          409,
        );
      }
      if (!reason) {
        throw new ServiceError(
          'Un motif est obligatoire pour bloquer un lot.',
          400,
        );
      }
      db.prepare(
        "UPDATE coupe_lots SET status = 'bloque', updated_at = datetime('now') WHERE id = ?",
      ).run(id);
    } else if (action === 'unblock') {
      if (lot.status !== 'bloque') {
        throw new ServiceError('Ce lot n’est pas bloqué.', 409);
      }
      db.prepare(
        "UPDATE coupe_lots SET status = 'en_coupe', updated_at = datetime('now') WHERE id = ?",
      ).run(id);
    } else if (action === 'cancel') {
      if (lot.status === 'transfere') {
        throw new ServiceError(
          'Un lot transféré ne peut pas être annulé : suivez la procédure de correction.',
          409,
        );
      }
      if (lot.status === 'annule') {
        throw new ServiceError('Ce lot est déjà annulé.', 409);
      }
      if (!reason) {
        throw new ServiceError(
          'Un motif est obligatoire pour annuler un lot.',
          400,
        );
      }
      db.prepare(
        "UPDATE coupe_lots SET status = 'annule', finished_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
      ).run(id);
    } else if (action === 'set_notes') {
      const notes = normalizeText(input.notes, 500);
      db.prepare(
        "UPDATE coupe_lots SET notes = ?, updated_at = datetime('now') WHERE id = ?",
      ).run(notes, id);
    } else {
      throw new ServiceError('Action inconnue sur le lot.', 400);
    }
    if (action !== 'set_notes') {
      addHistory(db, {
        action: `LOT_${action.toUpperCase()}`,
        entityType: 'lot',
        entityId: id,
        actorId: actor.id,
        oldValue: { status: lot.status },
        reason,
      });
    }
  });
  apply();
  return loadLotDetail(actor, id);
}
