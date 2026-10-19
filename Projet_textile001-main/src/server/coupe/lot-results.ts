/**
 * Résultats réels de la coupe : saisie minimale des quantités réelles
 * (jamais assimilées au prévu), écarts, anomalies, confirmation avec
 * génération du ticket de coupe.
 */
import { ServiceError } from '@/server/api/service-error';
import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import { addHistory, requireCoupe, requireId } from './common';
import { getOrder, updateCutQty, updateOrderStatus } from '../orders/orders';
import { getLot } from './lot-shared';
import {
  setTaskResults as setTaskResultsRaw,
  patchTask as patchTaskRaw,
  validateTask as validateTaskRaw,
} from './task-actions';
import { storeTicket } from './tickets';

export interface ActualLineInput {
  sizeId: number;
  cutQty: number;
  usableQty?: number;
  anomalyQty?: number;
  wasteQty?: number;
}

export interface RecordActualInput {
  lotId: number;
  lines: ActualLineInput[];
  actualLengthCm?: number;
  actualLayers?: number;
  anomalies?: Array<{
    sizeId?: number;
    type: 'tissu_defectueux' | 'piece_manquante' | 'quantite_incorrecte' | 'probleme_patron' | 'probleme_materiel' | 'autre';
    qty?: number;
    motif?: string;
  }>;
}

export function recordActual(actor: Actor, input: RecordActualInput): ReturnType<typeof getLot> {
  requireCoupe(actor);
  const db = sessionsDb();
  return db.transaction(() => {
    const lot = getLot(actor, requireId(input.lotId, 'Lot'));
    if (lot.status !== 'en_coupe') throw new ServiceError('Le lot n\'est pas en cours de coupe.', 409);

    const task = db.prepare('SELECT id FROM coupe_tasks WHERE lot_id=? AND status IN (\'en_cours\',\'a_faire\') ORDER BY id DESC LIMIT 1')
      .get(lot.id) as { id: number } | undefined;
    if (!task) throw new ServiceError('Aucune tâche de coupe active pour ce lot.', 400);

    const results = input.lines.map((line) => ({
      sizeId: requireId(line.sizeId, 'Taille'),
      plannedQty: lot.sizes.find((s) => s.sizeId === line.sizeId)?.plannedQty ?? 0,
      cutQty: Math.max(0, Math.trunc(line.cutQty)),
      usableQty: Math.max(0, Math.trunc(line.usableQty ?? line.cutQty)),
      anomalyQty: Math.max(0, Math.trunc(line.anomalyQty ?? 0)),
      wasteQty: Math.max(0, Math.trunc(line.wasteQty ?? 0)),
    }));

    const rawResults = results.map((r) => ({
      sizeId: r.sizeId,
      cutQty: r.cutQty,
      usableQty: r.usableQty,
      anomalyQty: r.anomalyQty,
      wasteQty: r.wasteQty,
    }));
    setTaskResultsRaw(actor, task.id, { results: rawResults });

    for (const r of results) {
      db.prepare('UPDATE coupe_lot_sizes SET cut_qty = ? WHERE lot_id = ? AND size_id = ?')
        .run(r.cutQty, lot.id, r.sizeId);
      if (lot.orderId) {
        updateCutQty(actor, lot.orderId, r.sizeId, r.cutQty);
      }
    }

    if (input.anomalies?.length) {
      const insertAnomaly = db.prepare(`
        INSERT INTO coupe_lot_anomalies (lot_id, size_id, type, qty, motif, created_by)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const a of input.anomalies) {
        insertAnomaly.run(
          lot.id,
          a.sizeId ?? null,
          a.type,
          a.qty ?? 0,
          a.motif ?? null,
          actor.id,
        );
      }
    }

    db.prepare(`
      UPDATE coupe_lots SET status='resultat_a_confirmer', updated_at=datetime('now') WHERE id=?
    `).run(lot.id);

    addHistory(db, {
      action: 'lot_actual_recorded',
      entityType: 'coupe_lot',
      entityId: lot.id,
      actorId: actor.id,
      newValue: { results, anomaliesCount: input.anomalies?.length ?? 0 },
    });

    return getLot(actor, lot.id);
  }).immediate();
}

export function confirmResults(actor: Actor, lotId: number): ReturnType<typeof getLot> {
  requireCoupe(actor);
  const db = sessionsDb();
  return db.transaction(() => {
    const lot = getLot(actor, requireId(lotId, 'Lot'));
    if (lot.status !== 'resultat_a_confirmer') throw new ServiceError('Aucun résultat à confirmer.', 409);

    const task = db.prepare('SELECT id FROM coupe_tasks WHERE lot_id=? AND status IN (\'en_cours\',\'a_faire\',\'terminee\') ORDER BY id DESC LIMIT 1')
      .get(lot.id) as { id: number } | undefined;
    if (task) {
      // La tâche passe « terminée » puis validée : la coupe physique est
      // finie (résultats saisis) et le responsable confirme.
      const current = (db.prepare('SELECT status FROM coupe_tasks WHERE id=?').get(task.id) as { status: string }).status;
      if (current === 'en_cours') {
        patchTaskRaw(actor, task.id, { action: 'finish' });
      }
      validateTaskRaw(actor, task.id, { notes: 'Validation après confirmation des résultats du lot' });
    }

    db.prepare(`
      UPDATE coupe_lots SET status='coupe', finished_at=datetime('now'), updated_at=datetime('now') WHERE id=?
    `).run(lot.id);

    // Ticket de coupe avec QR code + documents préparés pour le transfert.
    storeTicket(actor, {
      type: 'coupe',
      lotId: lot.id,
      refOperation: `CPE-${lot.code}`,
      payload: {
        sizes: lot.sizes.map((s) => ({
          sizeId: s.sizeId,
          sizeNom: s.sizeNom,
          plannedQty: s.plannedQty,
          cutQty: s.cutQty,
        })),
      },
    });

    if (lot.orderId) {
      const order = getOrder(actor, lot.orderId);
      const remaining = order.lines.reduce((sum, l) => sum + (l.qty - l.cutQty), 0);
      if (remaining <= 0) updateOrderStatus(actor, lot.orderId, 'coupé');
    }

    addHistory(db, {
      action: 'lot_results_confirmed',
      entityType: 'coupe_lot',
      entityId: lot.id,
      actorId: actor.id,
    });

    return getLot(actor, lot.id);
  }).immediate();
}
