import { ServiceError } from '@/server/api/service-error';
import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import { raiseAlert } from '@/server/alerts/alerts';
import type {
  StBalanceDTO,
  StMovementDTO,
  StTransferDTO,
} from '@/types/stock';
import {
  addHistory,
  nextCode,
  normalizeText,
  requireId,
  requireStock,
  requireText,
  toNumber,
} from './common';

/**
 * Mouvements de stock : le solde est toujours recalculé depuis les
 * mouvements réels. Toute quantité écrite est revérifiée côté serveur
 * dans une transaction ; aucun solde n'est modifiable directement.
 */

interface MovementRow {
  id: number;
  movement_type: StMovementDTO['movementType'];
  lot_code: string;
  size_label: string;
  qty: number;
  carton_code: string | null;
  reason: string | null;
  user_name: string | null;
  created_at: string;
}

export function listMovements(actor: Actor): StMovementDTO[] {
  requireStock(actor);
  const db = sessionsDb();
  return (
    db
      .prepare(
        `SELECT m.id, m.movement_type, l.code AS lot_code, s.nom AS size_label,
                m.qty, ct.code AS carton_code, m.reason,
                u.nom || ' ' || u.prenom AS user_name, m.created_at
         FROM st_movements m
         JOIN coupe_lots l ON l.id = m.lot_id
         JOIN sizes s ON s.id = m.size_id
         LEFT JOIN st_cartons ct ON ct.id = m.carton_id
         LEFT JOIN users u ON u.id = m.user_id
         ORDER BY m.id DESC LIMIT 500`,
      )
      .all() as MovementRow[]
  ).map((row) => ({
    id: row.id,
    movementType: row.movement_type,
    lotCode: row.lot_code,
    sizeLabel: row.size_label,
    qty: row.qty,
    cartonCode: row.carton_code,
    reason: row.reason,
    userName: row.user_name,
    createdAt: row.created_at,
  }));
}

export function listBalances(actor: Actor): StBalanceDTO[] {
  requireStock(actor);
  const db = sessionsDb();
  const rows = db
    .prepare(
      `SELECT m.lot_id, l.code AS lot_code, p.nom AS product_nom,
              col.nom AS color_nom, m.size_id, s.nom AS size_label,
              COALESCE(SUM(CASE WHEN m.movement_type = 'sortie' THEN -m.qty ELSE m.qty END), 0) AS in_stock
       FROM st_movements m
       JOIN coupe_lots l ON l.id = m.lot_id
       JOIN products p ON p.id = l.product_id
       JOIN colors col ON col.id = l.color_id
       JOIN sizes s ON s.id = m.size_id
       WHERE m.movement_type IN ('entree_cq','sortie','retour','ajustement','annulation')
       GROUP BY m.lot_id, m.size_id
       HAVING in_stock != 0
       ORDER BY l.code, s.nom`,
    )
    .all() as Array<{
    lot_id: number;
    lot_code: string;
    product_nom: string;
    color_nom: string;
    size_id: number;
    size_label: string;
    in_stock: number;
  }>;
  return rows.map((row) => ({
    lotId: row.lot_id,
    lotCode: row.lot_code,
    productNom: row.product_nom,
    colorNom: row.color_nom,
    sizeId: row.size_id,
    sizeLabel: row.size_label,
    inStock: row.in_stock,
  }));
}

/** Solde disponible d'une combinaison lot + taille, à l'écriture.
 * Les types standards stockent une quantité positive ; le signe est
 * appliqué ici (sortie = -qty). Ajustement/annulation sont signés. */
export function availableQty(
  db: import('better-sqlite3').Database,
  lotId: number,
  sizeId: number,
): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN movement_type = 'sortie' THEN -qty ELSE qty END), 0) AS total
       FROM st_movements
       WHERE lot_id = ? AND size_id = ?
         AND movement_type IN ('entree_cq','sortie','retour','ajustement','annulation')`,
    )
    .get(lotId, sizeId) as { total: number };
  return row.total;
}

function mapTransferRow(row: {
  id: number;
  code: string;
  carton_code: string;
  from_code: string | null;
  to_code: string;
  reason: string | null;
  performed_by_name: string | null;
  confirmed_at: string;
}): StTransferDTO {
  return {
    id: row.id,
    code: row.code,
    cartonCode: row.carton_code,
    fromCode: row.from_code,
    toCode: row.to_code,
    reason: row.reason,
    performedByName: row.performed_by_name,
    confirmedAt: row.confirmed_at,
  };
}

export function listTransfers(actor: Actor): StTransferDTO[] {
  requireStock(actor);
  const db = sessionsDb();
  return (
    db
      .prepare(
        `SELECT t.id, t.code, ct.code AS carton_code, lf.code AS from_code,
                lt.code AS to_code, t.reason,
                u.nom || ' ' || u.prenom AS performed_by_name, t.confirmed_at
         FROM st_transfers t
         JOIN st_cartons ct ON ct.id = t.carton_id
         LEFT JOIN st_locations lf ON lf.id = t.from_location_id
         JOIN st_locations lt ON lt.id = t.to_location_id
         LEFT JOIN users u ON u.id = t.performed_by
         ORDER BY t.id DESC LIMIT 300`,
      )
      .all() as Array<{
      id: number;
      code: string;
      carton_code: string;
      from_code: string | null;
      to_code: string;
      reason: string | null;
      performed_by_name: string | null;
      confirmed_at: string;
    }>
  ).map(mapTransferRow);
}

/** Transfert interne d'un carton clôturé vers un autre emplacement. */
export function transferCarton(actor: Actor, input: Record<string, unknown>): StTransferDTO {
  requireStock(actor);
  const db = sessionsDb();
  const cartonId = requireId(input.cartonId, 'Carton');
  const toLocationId = requireId(input.toLocationId, 'Emplacement de destination');
  const reason = normalizeText(input.reason, 300);
  const run = db.transaction((): StTransferDTO => {
    const carton = db
      .prepare('SELECT id, code, status, location_id FROM st_cartons WHERE id = ?')
      .get(cartonId) as
      | { id: number; code: string; status: string; location_id: number | null }
      | undefined;
    if (!carton) throw new ServiceError('Carton introuvable.', 404);
    if (carton.status !== 'cloture') {
      throw new ServiceError(
        'Seul un carton clôturé peut être transféré entre emplacements.',
        409,
      );
    }
    const destination = db
      .prepare('SELECT id, code, is_active FROM st_locations WHERE id = ?')
      .get(toLocationId) as { id: number; code: string; is_active: number } | undefined;
    if (!destination || destination.is_active !== 1) {
      throw new ServiceError('Emplacement de destination inactif ou introuvable.', 400);
    }
    if (carton.location_id === toLocationId) {
      throw new ServiceError(
        'Ce carton est déjà rangé dans cet emplacement.',
        409,
      );
    }
    const lines = db
      .prepare(
        'SELECT lot_id, size_id, COALESCE(SUM(qty), 0) AS qty FROM st_carton_lines WHERE carton_id = ? GROUP BY lot_id, size_id',
      )
      .all(cartonId) as Array<{ lot_id: number; size_id: number; qty: number }>;
    if (lines.length === 0) {
      throw new ServiceError('Ce carton est vide.', 409);
    }
    let fromCode: string | null = null;
    if (carton.location_id !== null) {
      const from = db
        .prepare('SELECT code FROM st_locations WHERE id = ?')
        .get(carton.location_id) as { code: string } | undefined;
      fromCode = from?.code ?? null;
    }
    const code = nextCode(db, 'st_transfers', 'TS-');
    const result = db
      .prepare(
        `INSERT INTO st_transfers
           (code, carton_id, from_location_id, to_location_id, reason, performed_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(code, cartonId, carton.location_id, toLocationId, reason, actor.id);
    const transferId = Number(result.lastInsertRowid);
    const totalQty = lines.reduce((sum, line) => sum + line.qty, 0);
    const mainLine = lines[0];
    db.prepare(
      `INSERT INTO st_movements
         (movement_type, lot_id, size_id, qty, carton_id,
          location_from_id, location_to_id, source_type, source_id, reason, user_id)
       VALUES ('transfert', ?, ?, ?, ?, ?, ?, 'st_transfer', ?, ?, ?)`,
    ).run(
      mainLine.lot_id,
      mainLine.size_id,
      totalQty,
      cartonId,
      carton.location_id,
      toLocationId,
      transferId,
      reason,
      actor.id,
    );
    db.prepare(
      `UPDATE st_cartons SET location_id = ?, updated_at = datetime('now') WHERE id = ?`,
    ).run(toLocationId, cartonId);
    addHistory(db, {
      action: 'CARTON_TRANSFERE',
      entityType: 'st_carton',
      entityId: cartonId,
      actorId: actor.id,
      oldValue: { locationId: carton.location_id },
      newValue: { locationId: toLocationId, transferCode: code },
      reason,
    });
    return {
      id: transferId,
      code,
      cartonCode: carton.code,
      fromCode,
      toCode: destination.code,
      reason,
      performedByName: null,
      confirmedAt: new Date().toISOString(),
    };
  });
  return run();
}

/** Sortie autorisée : motif obligatoire, jamais au-delà du disponible. */
export function recordSortie(actor: Actor, input: Record<string, unknown>): void {
  requireStock(actor);
  const db = sessionsDb();
  const lotId = requireId(input.lotId, 'Lot');
  const sizeId = requireId(input.sizeId, 'Taille');
  const qty = toNumber(input.qty, 'La quantité');
  const cartonId = input.cartonId ? requireId(input.cartonId, 'Carton') : null;
  const reason = requireText(input.reason, 'Le motif de sortie', 300);
  if (qty <= 0) {
    throw new ServiceError('La quantité sortie doit être strictement positive.', 400);
  }
  // Détection hors transaction : l'alerte persiste après le refus.
  const available = availableQty(db, lotId, sizeId);
  if (qty > available) {
    raiseAlert(db, {
      category: 'SORTIE_EXCEDENT_STOCK',
      severity: 'warning',
      objectType: 'st_movement',
      objectId: lotId,
      message: `Tentative de sortie de ${qty} pièce(s) alors que le stock disponible est de ${available}.`,
      ownerRole: 'chef_stock',
    });
    throw new ServiceError(
      `Sortie refusée : disponible ${available} pièce(s) pour ce lot et cette taille.`,
      409,
    );
  }
  const run = db.transaction((): void => {
    recordSortieInternal(db, { lotId, sizeId, qty, cartonId, reason, actorId: actor.id });
  });
  run();
}

/**
 * Cœur de l'enregistrement d'une sortie, SANS vérification de rôle et
 * SANS transaction propre : il s'exécute dans la transaction de
 * l'appelant (module Sécurité pour la confirmation de sortie physique,
 * anti-double-déduction). La disponibilité est re-vérifiée sous verrou
 * transactionnel (concurrence).
 */
export function recordSortieInternal(
  db: import('better-sqlite3').Database,
  input: {
    lotId: number;
    sizeId: number;
    qty: number;
    cartonId: number | null;
    reason: string;
    actorId: number | null;
  },
): void {
  const { lotId, sizeId, qty, cartonId, reason, actorId } = input;
  if (qty <= 0) {
    throw new ServiceError('La quantité sortie doit être strictement positive.', 400);
  }
  const current = availableQty(db, lotId, sizeId);
  if (qty > current) {
    throw new ServiceError(
      `Sortie refusée : disponible ${current} pièce(s) pour ce lot et cette taille.`,
      409,
    );
  }
  if (cartonId !== null) {
    const carton = db
      .prepare('SELECT id, code, status FROM st_cartons WHERE id = ?')
      .get(cartonId) as { id: number; code: string; status: string } | undefined;
    if (!carton) throw new ServiceError('Carton introuvable.', 404);
    const line = db
      .prepare(
        `SELECT id, qty FROM st_carton_lines
         WHERE carton_id = ? AND lot_id = ? AND size_id = ?`,
      )
      .get(cartonId, lotId, sizeId) as { id: number; qty: number } | undefined;
    if (!line || line.qty < qty) {
      throw new ServiceError(
        'Le carton ne contient pas assez de pièces pour cette référence.',
        409,
      );
    }
    const remaining = line.qty - qty;
    if (remaining === 0) {
      db.prepare('DELETE FROM st_carton_lines WHERE id = ?').run(line.id);
    } else {
      db.prepare('UPDATE st_carton_lines SET qty = ? WHERE id = ?').run(remaining, line.id);
    }
    const leftInCarton = db
      .prepare('SELECT COALESCE(SUM(qty), 0) AS total FROM st_carton_lines WHERE carton_id = ?')
      .get(cartonId) as { total: number };
    const nextStatus = leftInCarton.total === 0 ? 'vide' : 'partiellement_sorti';
    db.prepare(
      `UPDATE st_cartons SET status = ?, updated_at = datetime('now') WHERE id = ?`,
    ).run(nextStatus, cartonId);
    addHistory(db, {
      action: 'CARTON_LIGNES_MODIFIEES',
      entityType: 'st_carton',
      entityId: cartonId,
      actorId,
      oldValue: { qty: line.qty },
      newValue: { qty: remaining, status: nextStatus },
      reason,
    });
  }
  db.prepare(
    `INSERT INTO st_movements
       (movement_type, lot_id, size_id, qty, carton_id, reason, user_id)
     VALUES ('sortie', ?, ?, ?, ?, ?, ?)`,
  ).run(lotId, sizeId, qty, cartonId, reason, actorId ?? 0);
  addHistory(db, {
    action: 'SORTIE_ENREGISTREE',
    entityType: 'st_movement',
    entityId: 0,
    actorId,
    newValue: { lotId, sizeId, qty, cartonId },
    reason,
  });
}
