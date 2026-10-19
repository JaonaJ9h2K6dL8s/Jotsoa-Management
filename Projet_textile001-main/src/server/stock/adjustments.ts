import { ServiceError } from '@/server/api/service-error';
import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import { raiseAlert } from '@/server/alerts/alerts';
import {
  approveSensitiveRequest,
  createSensitiveRequest,
  refuseSensitiveRequest,
} from '@/server/approvals/approvals';
import type { StAdjustmentDTO } from '@/types/stock';
import {
  addHistory,
  nextCode,
  requireId,
  requireStock,
  requireText,
} from './common';

/**
 * Ajustements d'inventaire : opération sensible. L'écart ne devient un
 * mouvement correctif qu'après approbation par un AUTRE chef_stock
 * (mécanisme central des secondes validations ; l'auteur ne peut pas
 * s'auto-approuver). Aucun ajustement automatique du stock.
 */

const ADJUSTMENT_SELECT = `
  SELECT a.id, a.code, i.code AS inventory_code, c.code AS carton_code,
         l.code AS lot_code, s.nom AS size_label, a.delta_qty, a.reason,
         a.status, ru.nom || ' ' || ru.prenom AS requested_by_name,
         du.nom || ' ' || du.prenom AS decided_by_name,
         a.decision_note, a.created_at
  FROM st_adjustments a
  JOIN st_inventories i ON i.id = a.inventory_id
  JOIN st_cartons c ON c.id = a.carton_id
  JOIN coupe_lots l ON l.id = a.lot_id
  JOIN sizes s ON s.id = a.size_id
  LEFT JOIN users ru ON ru.id = a.requested_by
  LEFT JOIN users du ON du.id = a.decided_by`;

interface AdjustmentRow {
  id: number;
  code: string;
  inventory_id: number;
  carton_id: number;
  lot_id: number;
  size_id: number;
  delta_qty: number;
  status: string;
}

function mapAdjustment(row: Record<string, unknown>): StAdjustmentDTO {
  return {
    id: Number(row.id),
    code: String(row.code),
    inventoryCode: String(row.inventory_code),
    cartonCode: String(row.carton_code),
    lotCode: String(row.lot_code),
    sizeLabel: String(row.size_label),
    deltaQty: Number(row.delta_qty),
    reason: String(row.reason),
    status: row.status as StAdjustmentDTO['status'],
    requestedByName: (row.requested_by_name as string | null) ?? null,
    decidedByName: (row.decided_by_name as string | null) ?? null,
    decisionNote: (row.decision_note as string | null) ?? null,
    createdAt: String(row.created_at),
  };
}

export function listAdjustments(actor: Actor): StAdjustmentDTO[] {
  requireStock(actor);
  const db = sessionsDb();
  return (
    db.prepare(`${ADJUSTMENT_SELECT} ORDER BY a.id DESC LIMIT 300`).all() as Array<
      Record<string, unknown>
    >
  ).map(mapAdjustment);
}

/** Soumission des écarts : crée l'ajustement + la demande sensible. */
export function submitAdjustments(
  actor: Actor,
  input: Record<string, unknown>,
): void {
  requireStock(actor);
  const db = sessionsDb();
  const inventoryId = requireId(input.inventoryId, 'Inventaire');
  const rawItems = Array.isArray(input.items) ? input.items : [];
  if (rawItems.length === 0) {
    throw new ServiceError('Aucun écart à soumettre.', 400);
  }
  const run = db.transaction((): void => {
    const inventory = db
      .prepare('SELECT id, code, status FROM st_inventories WHERE id = ?')
      .get(inventoryId) as { id: number; code: string; status: string } | undefined;
    if (!inventory) throw new ServiceError('Session d’inventaire introuvable.', 404);
    if (inventory.status !== 'ecarts') {
      throw new ServiceError(
        'Comptez d’abord toutes les lignes : les écarts ne sont soumisables qu’après détection.',
        409,
      );
    }
    for (const raw of rawItems as Array<Record<string, unknown>>) {
      const lineId = requireId(raw.lineId, 'Ligne d’inventaire');
      const reason = requireText(raw.reason, 'Le motif de l’ajustement', 300);
      const line = db
        .prepare(
          `SELECT id, carton_id, lot_id, size_id, theoretical_qty, counted_qty
           FROM st_inventory_lines WHERE id = ? AND inventory_id = ?`,
        )
        .get(lineId, inventoryId) as
        | {
            id: number;
            carton_id: number;
            lot_id: number;
            size_id: number;
            theoretical_qty: number;
            counted_qty: number | null;
          }
        | undefined;
      if (!line || line.counted_qty === null) {
        throw new ServiceError('Cette ligne n’a pas encore été comptée.', 400);
      }
      const delta = line.counted_qty - line.theoretical_qty;
      if (delta === 0) {
        throw new ServiceError('Cette ligne ne présente aucun écart.', 400);
      }
      const code = nextCode(db, 'st_adjustments', 'AJ-');
      const result = db
        .prepare(
          `INSERT INTO st_adjustments
             (code, inventory_id, carton_id, lot_id, size_id, delta_qty, reason, requested_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(code, inventoryId, line.carton_id, line.lot_id, line.size_id, delta, reason, actor.id);
      const adjustmentId = Number(result.lastInsertRowid);
      createSensitiveRequest(db, {
        action: 'ajustement_stock',
        entityType: 'st_adjustment',
        entityId: adjustmentId,
        payload: { adjustmentId, inventoryId, delta, cartonId: line.carton_id },
        reason,
        requestedBy: actor.id,
      });
      addHistory(db, {
        action: 'AJUSTEMENT_SOUMIS',
        entityType: 'st_adjustment',
        entityId: adjustmentId,
        actorId: actor.id,
        newValue: { code, delta },
        reason,
      });
    }
    const open = db
      .prepare(
        `SELECT id FROM alerts WHERE category = 'AJUSTEMENT_EN_ATTENTE_ST'
         AND object_type = 'st_inventory' AND object_id = ? AND status IN ('nouvelle','en_cours')`,
      )
      .get(inventoryId) as { id: number } | undefined;
    if (!open) {
      raiseAlert(db, {
        category: 'AJUSTEMENT_EN_ATTENTE_ST',
        severity: 'warning',
        objectType: 'st_inventory',
        objectId: inventoryId,
        message: `Des ajustements d’inventaire ${inventory.code} attendent une seconde validation.`,
        ownerRole: 'chef_stock',
      });
    }
    db.prepare(`UPDATE st_inventories SET status = 'attente_validation' WHERE id = ?`).run(
      inventoryId,
    );
    addHistory(db, {
      action: 'INVENTAIRE_AJUSTEMENTS_SOUMIS',
      entityType: 'st_inventory',
      entityId: inventoryId,
      actorId: actor.id,
      newValue: { items: rawItems.length },
    });
  });
  run();
}

function finalizeInventory(
  db: import('better-sqlite3').Database,
  inventoryId: number,
  actorId: number,
): void {
  const pending = db
    .prepare(
      `SELECT COUNT(*) AS n FROM st_adjustments
       WHERE inventory_id = ? AND status = 'en_attente'`,
    )
    .get(inventoryId) as { n: number };
  if (pending.n === 0) {
    db.prepare(
      `UPDATE st_inventories SET status = 'valide', validated_at = datetime('now')
       WHERE id = ? AND status = 'attente_validation'`,
    ).run(inventoryId);
    addHistory(db, {
      action: 'INVENTAIRE_VALIDE',
      entityType: 'st_inventory',
      entityId: inventoryId,
      actorId,
      newValue: { status: 'valide' },
    });
  }
}

/** Applique l'ajustement approuvé : mouvement correctif + cohérence carton. */
function applyAdjustment(payload: unknown, approverId: number): void {
  const data = payload as { adjustmentId: number };
  const db = sessionsDb();
  const adjustment = db
    .prepare(
      `SELECT id, code, inventory_id, carton_id, lot_id, size_id, delta_qty, status
       FROM st_adjustments WHERE id = ?`,
    )
    .get(data.adjustmentId) as AdjustmentRow | undefined;
  if (!adjustment) throw new Error('Ajustement introuvable.');
  if (adjustment.status !== 'en_attente') {
    throw new Error('Cet ajustement a déjà été traité.');
  }
  db.prepare(
    `INSERT INTO st_movements
       (movement_type, lot_id, size_id, qty, carton_id, source_type, source_id, reason, user_id)
     VALUES ('ajustement', ?, ?, ?, ?, 'st_adjustment', ?, ?, ?)`,
  ).run(
    adjustment.lot_id,
    adjustment.size_id,
    adjustment.delta_qty,
    adjustment.carton_id,
    adjustment.id,
    `Ajustement ${adjustment.code}`,
    approverId,
  );
  const line = db
    .prepare(
      `SELECT id, qty FROM st_carton_lines
       WHERE carton_id = ? AND lot_id = ? AND size_id = ?`,
    )
    .get(adjustment.carton_id, adjustment.lot_id, adjustment.size_id) as
    | { id: number; qty: number }
    | undefined;
  const reason = `Ajustement ${adjustment.code}`;
  if (line) {
    const remaining = Math.max(0, line.qty + adjustment.delta_qty);
    if (remaining === 0) {
      db.prepare('DELETE FROM st_carton_lines WHERE id = ?').run(line.id);
    } else {
      db.prepare('UPDATE st_carton_lines SET qty = ? WHERE id = ?').run(remaining, line.id);
    }
  } else if (adjustment.delta_qty > 0) {
    db.prepare(
      `INSERT INTO st_carton_lines (carton_id, lot_id, controle_id, size_id, qty)
       SELECT ?, ?, COALESCE(MAX(controle_id), 0), ?, ? FROM st_carton_lines WHERE carton_id = ?`,
    ).run(
      adjustment.carton_id,
      adjustment.lot_id,
      adjustment.size_id,
      adjustment.delta_qty,
      adjustment.carton_id,
    );
  }
  addHistory(db, {
    action: 'AJUSTEMENT_APPLIQUE',
    entityType: 'st_adjustment',
    entityId: adjustment.id,
    actorId: approverId,
    newValue: { delta: adjustment.delta_qty, movement: 'ajustement' },
    reason,
  });
}

export function decideAdjustment(actor: Actor, input: Record<string, unknown>): void {
  requireStock(actor);
  if (actor.id === null) {
    throw new ServiceError('Session utilisateur invalide.', 401);
  }
  const actorId = actor.id;
  const db = sessionsDb();
  const adjustmentId = requireId(input.adjustmentId, 'Ajustement');
  const decision = String(input.decision ?? '');
  const note = typeof input.note === 'string' ? input.note : '';
  if (decision !== 'approve' && decision !== 'refuse') {
    throw new ServiceError('Décision inconnue.', 400);
  }
  const adjustment = db
    .prepare('SELECT id, inventory_id, status FROM st_adjustments WHERE id = ?')
    .get(adjustmentId) as
    | { id: number; inventory_id: number; status: string }
    | undefined;
  if (!adjustment) throw new ServiceError('Ajustement introuvable.', 404);
  if (adjustment.status !== 'en_attente') {
    throw new ServiceError('Cet ajustement a déjà été traité.', 409);
  }
  const inventory = db
    .prepare('SELECT status FROM st_inventories WHERE id = ?')
    .get(adjustment.inventory_id) as { status: string } | undefined;
  if (!inventory || inventory.status === 'annule') {
    throw new ServiceError('La session d’inventaire associée est annulée.', 409);
  }
  const request = db
    .prepare(
      `SELECT id FROM sensitive_requests
       WHERE entity_type = 'st_adjustment' AND entity_id = ? AND status = 'en_attente'`,
    )
    .get(adjustmentId) as { id: number } | undefined;
  if (!request) {
    throw new ServiceError('Aucune demande de validation en attente pour cet ajustement.', 409);
  }
  if (decision === 'refuse') {
    const run = db.transaction((): void => {
      refuseSensitiveRequest(db, {
        requestId: request.id,
        approver: actor,
        allowedRoles: ['chef_stock'],
        note,
      });
      db.prepare(
        `UPDATE st_adjustments
         SET status = 'refuse', decided_by = ?, decided_at = datetime('now'), decision_note = ?
         WHERE id = ?`,
      ).run(actorId, note, adjustmentId);
      addHistory(db, {
        action: 'AJUSTEMENT_REFUSE',
        entityType: 'st_adjustment',
        entityId: adjustmentId,
        actorId,
        newValue: { status: 'refuse' },
        reason: note,
      });
    });
    run();
    finalizeInventory(db, adjustment.inventory_id, actorId);
    return;
  }
  approveSensitiveRequest(db, {
    requestId: request.id,
    approver: actor,
    allowedRoles: ['chef_stock'],
    note: note || null,
    apply: (payload) => applyAdjustment(payload, actorId),
  });
  db.prepare(
    `UPDATE st_adjustments
     SET status = 'approuve', decided_by = ?, decided_at = datetime('now'), decision_note = ?
     WHERE id = ?`,
  ).run(actorId, note || null, adjustmentId);
  finalizeInventory(db, adjustment.inventory_id, actorId);
}
