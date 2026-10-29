import type Database from 'better-sqlite3';
import { ServiceError } from '@/server/api/service-error';
import type { Actor } from '@/server/users/users-service';
import { getPlan, readRevisionId } from './plans';
import { requireValidatedRevision } from './patterns';
import { assertCoupeWrite, inTransaction, requireId, requireInt } from './common';
import { nextTransferTicketNo } from './transfer-ticket';
import { resolveFabricConsumption } from './fabric-estimate';

/**
 * Transfert réel des pièces coupées vers Couture (étape 8).
 * Réutilise la chaîne existante : coupe_lots → coupe_transfers →
 * coupe_transfer_lines → réception couture → affectations/productions.
 * Aucune nouvelle table ni migration : `marker_plans.lot_id` (schéma
 * 0012) matérialise le lien plan → lot, protection anti-doublon.
 *
 * Conditions serveur (jamais la confiance au navigateur) :
 * 1. plan enregistré (placements persistés) et VALIDÉ ;
 * 2. révision de patron associée validée (patrons approuvés) ;
 * 3. ticket de production actif et correspondant au plan ;
 * 4. confirmation de coupe physique explicite (confirmCut), quantités
 *    déclarées ≤ placement enregistré (dessiner ≠ couper) ;
 * 5. un seul transfert par plan (UNIQUE(coupe_transfers.lot_id)).
 *
 * Quantités transférées : équivalent vêtements = min(coupé ÷ qté/vêtement)
 * sur les pièces requises, × couches du matelas (1 placement = 1 couche).
 */

export interface CutTransferResult {
  planId: number;
  lotId: number;
  lotCode: string;
  transferId: number;
  transferCode: string;
  ticketCoupeCode: string;
  ticketTransfertCode: string;
  /** Numéro lisible du ticket (TRF-AAAA-NNNNNN), généré côté serveur. */
  ticketNo: string;
  sizeId: number;
  /** Équivalent vêtements par couche (min des composants). */
  garmentsPerLayer: number;
  /** Quantité totale transférée (garmentsPerLayer × couches). */
  transferredQty: number;
  layers: number;
  /** Tissu consommé (kg) si le grammage du rouleau est connu. */
  fabricConsumedKg: number | null;
  /** Base du calcul : « matelas_declare » = valeur déclarée, pas une mesure. */
  fabricKgBasis?: 'matelas_declare' | null;
  /** Cause explicite quand la consommation n'est pas décomptée. */
  fabricKgUnavailableReason?: string | null;
  cutPieces: Array<{
    pieceId: number;
    label: string;
    qtyPerLayer: number;
    layers: number;
    totalQty: number;
  }>;
}

interface RollInfo {
  id: number;
  color_id: number | null;
  grammage_g_m2: number | null;
  remaining_weight_kg: number | null;
  remaining_qty: number | null;
  qty_unit: string | null;
  width_cm: number | null;
  status: string;
}

interface TicketRow {
  id: number;
  code: string;
  type: string;
  plan_id: number | null;
  status: string;
}

/** Ticket de coupe pour un plan (créé automatiquement au transfert si absent). */
export function createCutTicket(
  db: Database.Database,
  actor: Actor,
  planId: number,
): { code: string } {
  assertCoupeWrite(actor);
  const plan = getPlan(db, requireId(planId, 'Le plan'));
  if (plan.status === 'valide') {
    // Un plan validé est immuable : son ticket aussi (payload figé).
  }
  if (plan.placements.length === 0) {
    throw new ServiceError('Le plan ne contient aucun placement enregistré.', 409);
  }
  return inTransaction(db, () => {
    const code = nextTicketCode(db, 'TKT-C');
    db.prepare(
      `INSERT INTO production_tickets (code, type, plan_id, ref_operation, payload_json, qr_json, created_by)
       VALUES (?, 'coupe', ?, ?, ?, ?, ?)`,
    ).run(
      code,
      plan.id,
      'coupe_plan',
      JSON.stringify({ planId: plan.id, pieces: plan.total_pieces }),
      JSON.stringify({ code, type: 'coupe', planId: plan.id }),
      actor.id,
    );
    return { code };
  });
}

/**
 * Transfert principal : contrôle toutes les conditions puis crée, en
 * UNE transaction, le lot, le transfert confirmé, ses lignes, les
 * tickets et la consommation du rouleau.
 */
export function createCutTransfer(
  db: Database.Database,
  actor: Actor,
  input: {
    planId: unknown;
    ticketCode?: unknown;
    cutPieces?: unknown;
    confirmCut?: unknown;
    notes?: unknown;
  },
): CutTransferResult {
  assertCoupeWrite(actor);
  const planId = requireId(input.planId, 'Le plan');
  if (input.confirmCut !== true) {
    throw new ServiceError(
      'La confirmation de coupe physique est requise pour transférer.',
      400,
    );
  }
  const plan = getPlan(db, planId);
  if (plan.status !== 'valide') {
    throw new ServiceError(
      'Le plan doit être enregistré puis validé (administrateur) avant tout transfert.',
      409,
    );
  }
  const existingLot = db
    .prepare('SELECT lot_id FROM marker_plans WHERE id = ? AND lot_id IS NOT NULL')
    .get(planId) as { lot_id: number } | undefined;
  if (existingLot) {
    throw new ServiceError(
      `Ce plan a déjà été transféré vers la Couture (lot #${existingLot.lot_id}) : doublon refusé.`,
      409,
    );
  }
  const revisionId = readRevisionId(plan.input_json);
  if (revisionId === null) {
    throw new ServiceError('Plan sans révision de patron associée.', 409);
  }
  const revision = requireValidatedRevision(db, revisionId);
  const required = revision.pieces.filter(
    (piece) => piece.required && piece.status === 'configuree',
  );
  if (required.length === 0) {
    throw new ServiceError('Aucune pièce requise configurable dans cette révision.', 409);
  }

  // 1. Quantités déclarées coupées, bornées par le placement enregistré.
  const placed = new Map<number, number>();
  for (const placement of plan.placements) {
    placed.set(placement.pieceId, (placed.get(placement.pieceId) ?? 0) + 1);
  }
  const declared = new Map<number, number>();
  for (const entry of Array.isArray(input.cutPieces) ? input.cutPieces : []) {
    const record = entry as Record<string, unknown>;
    const pieceId = requireId(record.pieceId, 'La pièce');
    const qty = requireInt(record.qty, `La quantité coupée (pièce ${pieceId})`, 0, 100000);
    if (declared.has(pieceId)) {
      throw new ServiceError('Chaque pièce ne peut être déclarée qu’une fois.', 400);
    }
    const max = placed.get(pieceId) ?? 0;
    if (qty > max) {
      throw new ServiceError(
        `Quantité coupée (${qty}) supérieure au placement enregistré (${max}) `
        + `pour la pièce ${pieceId} : une pièce non placée ne peut pas être coupée.`,
        409,
      );
    }
    const piece = revision.pieces.find((candidate) => candidate.id === pieceId);
    if (!piece) {
      if (qty === 0) continue;
      throw new ServiceError(`Pièce inconnue (${pieceId}) pour cette révision.`, 400);
    }
    declared.set(pieceId, qty);
  }
  const cutPieces = [...declared.entries()].map(([pieceId, qtyPerLayer]) => {
    const piece = revision.pieces.find((candidate) => candidate.id === pieceId);
    if (!piece) throw new ServiceError(`Pièce inconnue (${pieceId}).`, 400);
    return {
      pieceId,
      label: piece.label,
      qtyPerLayer: qtyPerLayer,
      layers: plan.layers,
      totalQty: qtyPerLayer * plan.layers,
    };
  });
  // 2. Équivalent vêtements : min(coupé ÷ qté_par_vêtement) sur les
  //    pièces requises ; une pièce requise non déclarée bloque.
  let garments = Number.MAX_SAFE_INTEGER;
  for (const piece of required) {
    const qty = declared.get(piece.id) ?? 0;
    const perGarment = Math.max(1, Math.floor(piece.qty));
    garments = Math.min(garments, Math.floor(qty / perGarment));
  }
  if (!Number.isFinite(garments) || garments < 1) {
    throw new ServiceError(
      'Les quantités déclarées ne permettent pas de constituer un seul vêtement '
      + 'complet (toutes les pièces requises doivent être déclarées coupées).',
      400,
    );
  }
  // 3. Ticket de production correspondant au plan.
  const ticket = findTicket(db, input.ticketCode, planId);
  // 4. Rouleau : couleur obligatoire (lot), grammage optionnel.
  const roll = plan.roll_id === null ? null : db
    .prepare(
      `SELECT id, color_id, grammage_g_m2, remaining_weight_kg,
              remaining_qty, qty_unit, width_cm, status
         FROM coupe_rolls WHERE id = ?`,
    )
    .get(plan.roll_id) as RollInfo | undefined;
  if (!roll || roll.color_id === null) {
    throw new ServiceError(
      'Le rouleau du plan doit exister et porter une couleur pour créer le lot.',
      409,
    );
  }
  // Consommation tissu (moteur central, étape 18) : matelas DÉCLARÉ ×
  // largeur NOMINALE du rouleau, jamais la longueur occupée ni la
  // largeur utile ; anomalie bloquante au-delà de la tolérance.
  const { fabricKg, fabricKgBasis, unavailableReason } = resolveFabricConsumption({
    markerLengthCm: plan.marker_length_cm,
    matelasLengthCm: plan.matelas_length_cm,
    layers: plan.layers,
    widthCm: roll.width_cm,
    grammageGm2: roll.grammage_g_m2,
  });
  return inTransaction(db, () => {
    const lotCode = `LOT-P${plan.id}`;
    const transferCode = `TRF-P${plan.id}`;
    if (db.prepare('SELECT id FROM coupe_lots WHERE code = ?').get(lotCode)) {
      throw new ServiceError('Un lot existe déjà pour ce plan : doublon refusé.', 409);
    }
    const total = garments * plan.layers;
    const lotResult = db.prepare(
      `INSERT INTO coupe_lots (code, product_id, color_id, total_planned_qty, status,
                               responsable_id, notes, started_at, finished_at)
       VALUES (?, ?, ?, ?, 'transfere', ?, ?, datetime('now'), datetime('now'))`,
    ).run(
      lotCode,
      plan.product_id,
      roll.color_id,
      total,
      actor.id,
      input.notes === undefined || input.notes === null
        ? `Transfert depuis le plan de coupe #${plan.id} (révision « ${revision.modelName} » v${revision.version}).`
        : String(input.notes).slice(0, 500),
    );
    const lotId = Number(lotResult.lastInsertRowid);
    db.prepare('UPDATE marker_plans SET lot_id = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(lotId, plan.id);
    const ticketNo = nextTransferTicketNo(db);
    const transferResult = db.prepare(
      `INSERT INTO coupe_transfers (lot_id, code, ticket_no, status, performed_by, notes)
       VALUES (?, ?, ?, 'confirme', ?, ?)`,
    ).run(lotId, transferCode, ticketNo, actor.id, `Plan de coupe #${plan.id} validé`);
    const transferId = Number(transferResult.lastInsertRowid);
    const insertCutPiece = db.prepare(
      `INSERT INTO coupe_transfer_piece_counts
         (transfer_id, piece_id, qty_per_layer, layers)
       VALUES (?, ?, ?, ?)`,
    );
    for (const piece of cutPieces) {
      insertCutPiece.run(transferId, piece.pieceId, piece.qtyPerLayer, piece.layers);
    }
    db.prepare(
      `INSERT INTO coupe_transfer_lines (transfer_id, product_id, color_id, size_id, qty)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(transferId, plan.product_id, roll.color_id, revision.sizeId, total);
    // Ticket : lié au transfert + nouveau ticket de transfert.
    if (ticket) {
      db.prepare(
        `UPDATE production_tickets
            SET lot_id = ?, payload_json = ?, updated_at = datetime('now')
          WHERE id = ?`,
      ).run(
        lotId,
        JSON.stringify({
          planId: plan.id, transferId, lotId, garments, layers: plan.layers, total,
        }),
        ticket.id,
      );
    } else {
      const code = nextTicketCode(db, 'TKT-C');
      db.prepare(
        `INSERT INTO production_tickets (code, type, lot_id, plan_id, ref_operation,
                                         payload_json, qr_json, created_by)
         VALUES (?, 'coupe', ?, ?, 'coupe_plan', ?, ?, ?)`,
      ).run(
        code, lotId, plan.id,
        JSON.stringify({ planId: plan.id, transferId, lotId, garments, layers: plan.layers, total }),
        JSON.stringify({ code, type: 'coupe', planId: plan.id }),
        actor.id,
      );
    }
    const ticketTransfertCode = nextTicketCode(db, 'TKT-T');
    db.prepare(
      `INSERT INTO production_tickets (code, type, lot_id, plan_id, ref_operation,
                                       payload_json, qr_json, created_by)
       VALUES (?, 'transfert', ?, ?, 'transfert_couture', ?, ?, ?)`,
    ).run(
      ticketTransfertCode, lotId, plan.id,
      JSON.stringify({ transferId, transferCode, lotId, sizeId: revision.sizeId, qty: total }),
      JSON.stringify({ code: ticketTransfertCode, type: 'transfert', transferCode }),
      actor.id,
    );
    // Consommation du rouleau (si grammage et largeur nominale connus),
    // tracée dans coupe_roll_movements. Le métrage restant est décrémenté
    // DANS LA MÊME TRANSACTION, à partir du poids réellement déduit
    // (kg → m via grammage et largeur nominale) : une seule source de
    // vérité, aucune valeur négative. Rouleau sans métrage fiable
    // (qty_unit ≠ 'm' ou remaining_qty inconnu) : kg seuls, métrage
    // inchangé et jamais inventé.
    if (fabricKg !== null && roll.remaining_weight_kg !== null
      && roll.grammage_g_m2 !== null && roll.width_cm !== null) {
      const remaining = roll.remaining_weight_kg - fabricKg;
      if (remaining < -1e-9) {
        throw new ServiceError(
          `Poids du rouleau insuffisant : ${fabricKg} kg nécessaires, `
          + `${roll.remaining_weight_kg} kg restants.`,
          409,
        );
      }
      const clamped = Math.max(0, remaining);
      let metersRemaining: number | null = null;
      if (roll.qty_unit === 'm' && roll.remaining_qty !== null) {
        const consumedM = (fabricKg * 1000)
          / (roll.grammage_g_m2 * (roll.width_cm / 100));
        const meters = roll.remaining_qty - consumedM;
        if (meters < -1e-9) {
          throw new ServiceError(
            `Longueur du rouleau insuffisante : ${consumedM.toFixed(3)} m `
            + `nécessaires (${plan.layers} couche(s) × matelas de `
            + `${plan.matelas_length_cm} cm), ${roll.remaining_qty} m restants.`,
            409,
          );
        }
        metersRemaining = Math.max(0, meters);
      }
      db.prepare(
        `UPDATE coupe_rolls SET remaining_weight_kg = ?,
           remaining_qty = COALESCE(?, remaining_qty), status =
           CASE WHEN ? <= 0.001 THEN 'epuise' ELSE status END,
           updated_at = datetime('now')
         WHERE id = ?`,
      ).run(clamped, metersRemaining, clamped, roll.id);
      db.prepare(
        `INSERT INTO coupe_roll_movements
           (roll_id, movement_type, weight_before, weight_after, qty, unit, reason, user_id)
         VALUES (?, 'consommation', ?, ?, ?, 'kg', ?, ?)`,
      ).run(
        roll.id, roll.remaining_weight_kg, clamped, fabricKg,
        `Transfert ${transferCode} (plan #${plan.id})`, actor.id,
      );
    }
    db.prepare(
      `INSERT INTO coupe_history (action, entity_type, entity_id, actor_id, new_value, reason)
       VALUES ('PLAN_TRANSFERE', 'plan', ?, ?, ?, 'Transfert vers Couture')`,
    ).run(
      plan.id,
      actor.id,
      JSON.stringify({
        lotId, transferId, garments, layers: plan.layers, total,
        fabricKg, revisionId, version: revision.version,
      }),
    );
    return {
      planId: plan.id,
      lotId,
      lotCode,
      transferId,
      transferCode,
      ticketCoupeCode: ticket?.code ?? '',
      ticketTransfertCode,
      ticketNo,
      sizeId: revision.sizeId,
      garmentsPerLayer: garments,
      transferredQty: total,
      layers: plan.layers,
      fabricConsumedKg: fabricKg,
      fabricKgBasis,
      fabricKgUnavailableReason: fabricKg === null ? unavailableReason : null,
      cutPieces,
    };
  });
}

function findTicket(
  db: Database.Database, rawCode: unknown, planId: number,
): TicketRow | null {
  if (rawCode === undefined || rawCode === null || rawCode === '') return null;
  if (typeof rawCode !== 'string') {
    throw new ServiceError('Code de ticket invalide.', 400);
  }
  const ticket = db.prepare(
    'SELECT id, code, type, plan_id, status FROM production_tickets WHERE code = ?',
  ).get(rawCode.trim()) as TicketRow | undefined;
  if (!ticket || ticket.status !== 'actif') {
    throw new ServiceError('Ticket de production introuvable ou annulé.', 400);
  }
  if (ticket.type !== 'coupe' || ticket.plan_id !== planId) {
    throw new ServiceError(
      'Le ticket de production ne correspond pas à ce plan de coupe.',
      409,
    );
  }
  return ticket;
}

function nextTicketCode(db: Database.Database, prefix: string): string {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const code = `${prefix}-${Date.now().toString(36).toUpperCase()}-${attempt}`;
    const exists = db.prepare('SELECT 1 FROM production_tickets WHERE code = ?')
      .get(code);
    if (!exists) return code;
  }
  throw new ServiceError('Impossible de générer un code de ticket unique.', 500);
}
