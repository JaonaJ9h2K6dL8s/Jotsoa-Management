/**
 * Workflow automatisé des lots de coupe — transitions et plan de placement.
 *
 * Responsabilités :
 * - génération et validation du plan de placement (versions conservées)
 * - démarrage de la coupe, annulation
 * - ré-export des autres étapes (création, résultats, transfert) pour
 *   stabiliser les imports des routes API.
 *
 * Chaque étape critique exige une validation humaine ; le système
 * ne devine jamais une donnée ni ne passe automatiquement un lot
 * à l'état suivant sans confirmation.
 */
import { ServiceError } from '@/server/api/service-error';
import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import { addHistory, requireCoupe, requireId } from './common';
import { getOrder, updateOrderStatus } from '../orders/orders';
import type { NestingInput } from './nesting';
import type { MarkerPlanRow } from './marker';
import { createMarkerPlan, validateMarkerPlan } from './marker';
import { createTask } from './tasks';
import {
  getLot,
  loadSizes,
} from './lot-shared';
import { checkLotReadiness } from './lot-preparation';
import { requireTechnicalProduct } from './technical-catalogue';

// Ré-exports : point d'entrée unique du workflow pour les routes API.
export {
  checkLotReadiness,
  createLotFromOrder,
  proposeMatelas,
} from './lot-preparation';
export type { CreateLotFromOrderInput, ProposeMatelasInput } from './lot-preparation';
export { confirmResults, recordActual } from './lot-results';
export type { ActualLineInput, RecordActualInput } from './lot-results';
export { confirmTransfer, prepareTransfer } from './lot-transfer';
export type { ConfirmTransferInput, TransferLineInput } from './lot-transfer';
export {
  getLot,
  getLotExtras,
  listLots,
  type LotAnomalyDTO,
  type LotCheckResult,
  type LotExtras,
  type LotWorkflowRow,
} from './lot-shared';

export interface GeneratePlanInput {
  lotId: number;
  rollId: number;
  usableWidthCm: number;
  matelasLengthCm: number;
  layers: number;
  gapCm?: number;
  grammageGm2?: number;
  coupeTableId?: number | null;
  plannedStart?: string;
  plannedEnd?: string;
}

export function generatePlan(actor: Actor, input: GeneratePlanInput): MarkerPlanRow {
  requireCoupe(actor);
  const db = sessionsDb();
  return db.transaction(() => {
    const lot = getLot(actor, requireId(input.lotId, 'Lot'));
    if (!['brouillon','a_verifier','plan_a_valider','pret_a_couper','bloque'].includes(lot.status)) {
      throw new ServiceError(`Génération de plan impossible pour le statut ${lot.status}.`, 409);
    }
    const sizes = loadSizes(db, lot.id);
    if (sizes.length === 0) throw new ServiceError('Aucune taille dans le lot.', 400);

    // La catégorie (adulte/enfant) vient du catalogue technique du
    // produit, jamais d'une valeur codée en dur.
    const category = requireTechnicalProduct(actor, lot.productId).category;
    const nestingInput: NestingInput = {
      productId: lot.productId,
      category,
      sizes: sizes.map((s) => ({ sizeId: s.sizeId, qty: s.plannedQty })),
      usableWidthCm: input.usableWidthCm,
      matelasLengthCm: input.matelasLengthCm,
      layers: input.layers,
      gapCm: input.gapCm ?? 1,
      grammageGm2: input.grammageGm2 ?? 160,
      coupeTableId: input.coupeTableId,
      rollId: input.rollId,
      lotId: lot.id,
    };

    // Créneau par défaut : maintenant → dans 2 heures si non fourni.
    const now = Date.now();
    const plannedStart = input.plannedStart ?? new Date(now).toISOString();
    const plannedEnd = input.plannedEnd ?? new Date(now + 2 * 60 * 60 * 1000).toISOString();

    // createMarkerPlan insère une nouvelle version : les plans
    // précédemment validés restent conservés dans marker_plans.
    const plan = createMarkerPlan(actor, {
      ...nestingInput,
      plannedStart,
      plannedEnd,
      excludingPlan: lot.markerPlanId ?? undefined,
    });

    db.prepare(`
      UPDATE coupe_lots
      SET marker_plan_id=?, roll_id=?, coupe_table_id=?, proposed_layers=?,
          proposed_matelas_length_cm=?, status='plan_a_valider', updated_at=datetime('now')
      WHERE id=?
    `).run(plan.id, input.rollId, input.coupeTableId, input.layers, input.matelasLengthCm, lot.id);

    addHistory(db, {
      action: 'lot_plan_generated',
      entityType: 'coupe_lot',
      entityId: lot.id,
      actorId: actor.id,
      newValue: { planId: plan.id, efficiency: plan.efficiency, markerLengthCm: plan.markerLengthCm },
    });

    return plan;
  }).immediate();
}

export function validatePlan(actor: Actor, lotId: number): ReturnType<typeof getLot> {
  requireCoupe(actor);
  const db = sessionsDb();
  return db.transaction(() => {
    const lot = getLot(actor, requireId(lotId, 'Lot'));
    if (lot.status !== 'plan_a_valider') throw new ServiceError('Le lot n\'est pas en attente de validation de plan.', 409);
    if (!lot.markerPlanId) throw new ServiceError('Aucun plan de placement lié au lot.', 400);

    const check = checkLotReadiness(actor, lot.id);
    if (!check.ok) throw new ServiceError(`Vérifications bloquantes : ${check.blockers.join(' ; ')}`, 400);

    // La validation fige la version exacte du plan ; la version
    // validée est conservée même en cas de régénération ultérieure.
    validateMarkerPlan(actor, lot.markerPlanId);

    db.prepare(`
      UPDATE coupe_lots
      SET status='pret_a_couper', validated_by=?, validated_at=datetime('now'), updated_at=datetime('now')
      WHERE id=?
    `).run(actor.id, lot.id);

    addHistory(db, {
      action: 'lot_plan_validated',
      entityType: 'coupe_lot',
      entityId: lot.id,
      actorId: actor.id,
      newValue: { markerPlanId: lot.markerPlanId },
    });

    return getLot(actor, lot.id);
  }).immediate();
}

export function startCutting(actor: Actor, lotId: number): ReturnType<typeof getLot> {
  requireCoupe(actor);
  const db = sessionsDb();
  return db.transaction(() => {
    const lot = getLot(actor, requireId(lotId, 'Lot'));
    if (lot.status !== 'pret_a_couper') throw new ServiceError('Le lot n\'est pas prêt à couper.', 409);

    const task = createTask(actor, {
      lotId: lot.id,
      code: `COUPE-${lot.code}`,
      description: `Opération de coupe du lot ${lot.code}`,
      isMandatory: true,
      requiresResults: true,
    });

    db.prepare(`
      UPDATE coupe_lots SET status='en_coupe', started_at=datetime('now'), updated_at=datetime('now')
      WHERE id=?
    `).run(lot.id);

    addHistory(db, {
      action: 'lot_cutting_started',
      entityType: 'coupe_lot',
      entityId: lot.id,
      actorId: actor.id,
      newValue: { taskId: task.id },
    });

    return getLot(actor, lot.id);
  }).immediate();
}

export function cancelLot(actor: Actor, lotId: number, reason?: string): ReturnType<typeof getLot> {
  requireCoupe(actor);
  const db = sessionsDb();
  return db.transaction(() => {
    const lot = getLot(actor, requireId(lotId, 'Lot'));
    if (['transfere','annule'].includes(lot.status)) throw new ServiceError('Lot déjà terminé ou annulé.', 409);
    db.prepare(`
      UPDATE coupe_lots SET status='annule', notes=COALESCE(notes,'') || ' | Annulé : ' || ?, updated_at=datetime('now') WHERE id=?
    `).run(reason ?? 'Sans motif', lot.id);

    if (lot.orderId) {
      const order = getOrder(actor, lot.orderId);
      const remaining = order.lines.some((l) => l.cutQty < l.qty);
      updateOrderStatus(actor, lot.orderId, remaining ? 'a_couper' : 'coupé');
    }

    addHistory(db, {
      action: 'lot_cancelled',
      entityType: 'coupe_lot',
      entityId: lot.id,
      actorId: actor.id,
      reason,
    });

    return getLot(actor, lot.id);
  }).immediate();
}
