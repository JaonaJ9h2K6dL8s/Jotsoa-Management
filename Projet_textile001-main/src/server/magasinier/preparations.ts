import { ServiceError } from '@/server/api/service-error';
import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import { raiseAlert } from '@/server/alerts/alerts';
import type { MgOrderDTO, MgReservationDTO } from '@/types/magasinier';
import {
  addMgHistory,
  nextMgCode,
  requireId,
  requireMagasinier,
  requireText,
  toNumber,
} from './common';
import {
  orderStatusFromTotals,
  reservableCartons,
} from './availability';

/**
 * Préparation des commandes validées : réservations traçables du stock
 * réel (module Stock étape 8), par lot + taille + carton. La quantité
 * réservable = disponible - réservations actives, recalculée côté
 * serveur DANS la transaction (protection contre les concours).
 * Aucune sortie physique ici : le stock n'est jamais décrémenté par
 * le chef_magasinier.
 */

/** Vue préparation : pour chaque ligne, les cartons réservables réels. */
export function getOrderPreparation(actor: Actor, orderId: number): MgOrderDTO {
  requireMagasinier(actor);
  const db = sessionsDb();
  const order = db
    .prepare(
      `SELECT o.*, d.code AS document_code FROM mg_orders o
       JOIN mg_documents d ON d.id = o.document_id WHERE o.id = ?`,
    )
    .get(orderId) as
    | { id: number; code: string; document_code: string; external_order_no: string | null; client_name: string | null; order_date: string | null; status: string; created_at: string; notes: string | null }
    | undefined;
  if (!order) throw new ServiceError('Commande introuvable.', 404);
  const lineRows = db
    .prepare(
      `SELECT l.id, l.product_id, p.nom AS product_nom, l.color_id, c.nom AS color_nom,
              l.size_id, s.nom AS size_nom, l.raw_text, l.qty_ordered, l.qty_prepared,
              l.match_status, l.notes
       FROM mg_order_lines l
       LEFT JOIN products p ON p.id = l.product_id
       LEFT JOIN colors c ON c.id = l.color_id
       LEFT JOIN sizes s ON s.id = l.size_id
       WHERE l.order_id = ? ORDER BY l.id`,
    )
    .all(orderId) as Array<{
    id: number;
    product_id: number | null;
    product_nom: string | null;
    color_id: number | null;
    color_nom: string | null;
    size_id: number | null;
    size_nom: string | null;
    raw_text: string | null;
    qty_ordered: number;
    qty_prepared: number;
    match_status: string;
    notes: string | null;
  }>;
  return {
    id: order.id,
    code: order.code,
    documentCode: order.document_code,
    externalOrderNo: order.external_order_no,
    clientName: order.client_name,
    orderDate: order.order_date,
    status: order.status as MgOrderDTO['status'],
    createdAt: order.created_at,
    duplicateWarning: order.notes?.includes('Doublon potentiel') ? order.notes : null,
    lines: lineRows.map((row) => ({
      id: row.id,
      productId: row.product_id,
      productNom: row.product_nom,
      colorId: row.color_id,
      colorNom: row.color_nom,
      sizeId: row.size_id,
      sizeNom: row.size_nom,
      rawText: row.raw_text,
      qtyOrdered: row.qty_ordered,
      qtyPrepared: row.qty_prepared,
      matchStatus: row.match_status as MgOrderDTO['lines'][number]['matchStatus'],
      notes: row.notes,
      reservableQty: 0,
      preparedQty: row.qty_prepared,
      ...(row.product_id && row.size_id
        ? {
            reservableCartons: reservableCartons(
              db,
              orderId,
              row.product_id,
              row.color_id,
              row.size_id,
            ),
          }
        : {}),
    })),
  };
}

/** Réservation atomique : re-vérification serveur dans la transaction. */
export function reserveStock(actor: Actor, input: Record<string, unknown>): void {
  requireMagasinier(actor);
  if (actor.id === null) throw new ServiceError('Session utilisateur invalide.', 401);
  const actorId = actor.id;
  const db = sessionsDb();
  const orderId = requireId(input.orderId, 'Commande');
  const items = Array.isArray(input.items) ? input.items : [];
  if (items.length === 0) throw new ServiceError('Aucune réservation demandée.', 400);
  const run = db.transaction((): void => {
    const order = db
      .prepare('SELECT id, code, status FROM mg_orders WHERE id = ?')
      .get(orderId) as { id: number; code: string; status: string } | undefined;
    if (!order) throw new ServiceError('Commande introuvable.', 404);
    if (order.status !== 'valide' && order.status !== 'en_preparation' && order.status !== 'partielle') {
      throw new ServiceError(
        `La préparation exige une commande validée (statut : ${order.status}).`,
        409,
      );
    }
    for (const raw of items as Array<Record<string, unknown>>) {
      const lineId = requireId(raw.lineId, 'Ligne');
      const cartonId = requireId(raw.cartonId, 'Carton');
      const qty = toNumber(raw.qty, 'La quantité');
      if (qty <= 0) {
        throw new ServiceError('La quantité à préparer doit être strictement positive.', 400);
      }
      const line = db
        .prepare(
          `SELECT id, order_id, product_id, size_id, qty_ordered, qty_prepared
           FROM mg_order_lines WHERE id = ?`,
        )
        .get(lineId) as
        | { id: number; order_id: number; product_id: number | null; size_id: number | null; qty_ordered: number; qty_prepared: number }
        | undefined;
      if (!line || line.order_id !== orderId) {
        throw new ServiceError('Ligne inconnue pour cette commande.', 404);
      }
      if (line.product_id === null || line.size_id === null) {
        throw new ServiceError('Impossible de réserver un produit non reconnu.', 409);
      }
      const remaining = line.qty_ordered - line.qty_prepared;
      if (qty > remaining) {
        throw new ServiceError(
          `Quantité supérieure au reste à préparer (${remaining}).`,
          409,
        );
      }
      // Re-vérification sous transaction : stock et réservations actives.
      const carton = db
        .prepare(
          `SELECT c.id, c.code, c.status FROM st_cartons c WHERE c.id = ?`,
        )
        .get(cartonId) as { id: number; code: string; status: string } | undefined;
      if (!carton) throw new ServiceError('Carton introuvable.', 404);
      if (carton.status !== 'cloture' && carton.status !== 'partiellement_sorti') {
        throw new ServiceError(
          `Le carton ${carton.code} n'est pas disponible pour la préparation (statut : ${carton.status}).`,
          409,
        );
      }
      const candidates = reservableCartons(
        db,
        orderId,
        line.product_id,
        null,
        line.size_id,
      ).filter((candidate) => candidate.cartonId === cartonId);
      const candidate = candidates[0];
      if (!candidate || candidate.reservableQty < qty) {
        const excess = new ServiceError(
          `Quantité indisponible dans le carton ${carton.code} (disponible : ${candidate?.reservableQty ?? 0}).`,
          409,
        );
        (excess as ServiceError & { mgExcess?: boolean }).mgExcess = true;
        throw excess;
      }
      const code = nextMgCode(db, 'mg_reservations', 'RES-');
      db.prepare(
        `INSERT INTO mg_reservations
           (code, order_id, line_id, lot_id, size_id, carton_id, qty, reserved_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(code, orderId, lineId, candidate.lotId, line.size_id, cartonId, qty, actorId);
      db.prepare(
        `UPDATE mg_order_lines SET qty_prepared = qty_prepared + ? WHERE id = ?`,
      ).run(qty, lineId);
      addMgHistory(db, {
        action: 'STOCK_RESERVE',
        entityType: 'mg_reservation',
        entityId: 0,
        actorId,
        newValue: { code, orderId, lineId, cartonId, qty, lotId: candidate.lotId },
      });
    }
    const totals = db
      .prepare(
        `SELECT COALESCE(SUM(qty_ordered), 0) AS ordered,
                COALESCE(SUM(qty_prepared), 0) AS prepared
         FROM mg_order_lines WHERE order_id = ?`,
      )
      .get(orderId) as { ordered: number; prepared: number };
    const nextStatus = orderStatusFromTotals(totals.ordered, totals.prepared);
    db.prepare('UPDATE mg_orders SET status = ? WHERE id = ?').run(nextStatus, orderId);
    addMgHistory(db, {
      action: 'PREPARATION_MISE_A_JOUR',
      entityType: 'mg_order',
      entityId: orderId,
      actorId,
      newValue: { status: nextStatus, prepared: totals.prepared, ordered: totals.ordered },
    });
  });
  try {
    run();
  } catch (error) {
    // L'alerte doit persister après le rollback de la transaction.
    if ((error as ServiceError & { mgExcess?: boolean }).mgExcess) {
      raiseAlert(db, {
        category: 'RESERVATION_EXCEDENT_MG',
        severity: 'warning',
        objectType: 'mg_order',
        objectId: orderId,
        message: 'Réservation refusée : quantité indisponible dans le carton demandé.',
        ownerRole: 'chef_magasinier',
      });
    }
    throw error;
  }
}

/** Libération contrôlée d'une réservation active (motif obligatoire). */
export function releaseReservation(actor: Actor, input: Record<string, unknown>): void {
  requireMagasinier(actor);
  const db = sessionsDb();
  const reservationId = requireId(input.reservationId, 'Réservation');
  const reason = requireText(input.reason, 'Le motif', 300);
  const run = db.transaction((): void => {
    const reservation = db
      .prepare('SELECT id, code, order_id, line_id, qty, status FROM mg_reservations WHERE id = ?')
      .get(reservationId) as
      | { id: number; code: string; order_id: number; line_id: number; qty: number; status: string }
      | undefined;
    if (!reservation) throw new ServiceError('Réservation introuvable.', 404);
    if (reservation.status !== 'active') {
      throw new ServiceError('Cette réservation est déjà libérée.', 409);
    }
    db.prepare(
      `UPDATE mg_reservations SET status = 'liberee', released_by = ?,
         released_at = datetime('now'), release_reason = ? WHERE id = ?`,
    ).run(actor.id ?? 0, reason, reservationId);
    db.prepare(
      `UPDATE mg_order_lines SET qty_prepared = MAX(0, qty_prepared - ?) WHERE id = ?`,
    ).run(reservation.qty, reservation.line_id);
    const totals = db
      .prepare(
        `SELECT COALESCE(SUM(qty_ordered), 0) AS ordered,
                COALESCE(SUM(qty_prepared), 0) AS prepared
         FROM mg_order_lines WHERE order_id = ?`,
      )
      .get(reservation.order_id) as { ordered: number; prepared: number };
    const nextStatus = orderStatusFromTotals(totals.ordered, totals.prepared);
    db.prepare('UPDATE mg_orders SET status = ? WHERE id = ?').run(
      nextStatus,
      reservation.order_id,
    );
    addMgHistory(db, {
      action: 'RESERVATION_LIBEREE',
      entityType: 'mg_reservation',
      entityId: reservationId,
      actorId: actor.id ?? 0,
      oldValue: { status: 'active', qty: reservation.qty },
      newValue: { status: 'liberee' },
      reason,
    });
  });
  run();
}

export function listReservations(actor: Actor): MgReservationDTO[] {
  requireMagasinier(actor);
  const db = sessionsDb();
  return (
    db
      .prepare(
        `SELECT r.id, r.code, o.code AS order_code, c.code AS carton_code,
                l.code AS lot_code, s.nom AS size_label, r.qty, r.status,
                ru.nom || ' ' || ru.prenom AS reserved_by_name, r.created_at,
                du.nom || ' ' || du.prenom AS released_by_name, r.release_reason
         FROM mg_reservations r
         JOIN mg_orders o ON o.id = r.order_id
         JOIN st_cartons c ON c.id = r.carton_id
         JOIN coupe_lots l ON l.id = r.lot_id
         JOIN sizes s ON s.id = r.size_id
         LEFT JOIN users ru ON ru.id = r.reserved_by
         LEFT JOIN users du ON du.id = r.released_by
         ORDER BY r.id DESC LIMIT 300`,
      )
      .all() as Array<{
      id: number;
      code: string;
      order_code: string;
      carton_code: string;
      lot_code: string;
      size_label: string;
      qty: number;
      status: 'active' | 'liberee';
      reserved_by_name: string | null;
      created_at: string;
      released_by_name: string | null;
      release_reason: string | null;
    }>
  ).map((row) => ({
    id: row.id,
    code: row.code,
    orderCode: row.order_code,
    cartonCode: row.carton_code,
    lotCode: row.lot_code,
    sizeLabel: row.size_label,
    qty: row.qty,
    status: row.status,
    reservedByName: row.reserved_by_name,
    createdAt: row.created_at,
    releasedByName: row.released_by_name,
    releaseReason: row.release_reason,
  }));
}
