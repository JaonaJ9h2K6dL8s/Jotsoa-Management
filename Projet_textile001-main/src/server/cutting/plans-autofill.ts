import type Database from 'better-sqlite3';
import { ServiceError } from '@/server/api/service-error';
import type { Actor } from '@/server/users/users-service';
import { computeMetrics } from '@/lib/cutting/optimizer';
import { fillMatelas } from '@/lib/cutting/fill-matelas';
import type { OptimizerPiece, OptimizerPlacement } from '@/lib/cutting/optimizer';
import { validateCandidate } from '@/lib/cutting/nesting-validate';
import {
  createPlan, deleteDraftPlan, getPlan, patchPlanInputJson, readPlanInputJson, readRevisionId,
} from './plans';
import { savePlan } from './plans-save';
import { requireValidatedRevision } from './patterns';
import { assertCoupeWrite } from './common';

/**
 * Calcul AUTOMATIQUE multi-matelas (l'utilisateur ne saisit rien) :
 * 1. Capacité d'un matelas PLEIN : nombre de jeux complets du patron
 *    (ex. polo = 6 pièces) qui tiennent dans le matelas — aucun jeu
 *    incomplet n'est retenu (une pièce orpheline ne produit rien).
 * 2. Contrainte ROULEAU : chaque matelas consomme
 *    longueur_matelas × couches de tissu. Le nombre de matelas est
 *    borné par le métrage restant du rouleau (et par son poids via le
 *    grammage quand celui-ci est connu).
 * 3. Duplication : les matelas supplémentaires sont créés PLEINS et
 *    enregistrés automatiquement ; le nombre total de pièces obtenues
 *    est déduit (jeux × couches × pièces par jeu).
 */

export interface AutofillDuplicate {
  planId: number;
  /** Jeux complets placés sur ce matelas dupliqué (plein). */
  sets: number;
}

export interface AutofillResult {
  /** Proposition de placement du plan COURANT (format serveur). */
  placements: OptimizerPlacement[];
  method: 'shelf-ffd' | 'nest-blf';
  metrics: ReturnType<typeof computeMetrics>;
  /** Pièces par jeu complet (ex. polo = 6). */
  piecesPerSet: number;
  /** Jeux complets sur CE matelas (matelas plein). */
  setsOnPlan: number;
  /** Capacité d'un matelas plein : jeux complets qui tiennent. */
  capacitySets: number;
  layers: number;
  /** Vêtements par matelas plein = capacitySets × couches. */
  garmentsPerMatelas: number;
  /** Pièces brutes par matelas plein. */
  piecesPerMatelas: number;
  /** Métrage de tissu consommé par matelas (m) = longueur × couches. */
  fabricPerMatelasM: number;
  /** Métrage disponible sur le rouleau (m), null si inconnu. */
  rollAvailableM: number | null;
  /** Métrage restant après coupe de tous les matelas (m). */
  rollRemainingAfterM: number | null;
  /** Nombre total de matelas pleins (plan courant + dupliqués). */
  totalMatelas: number;
  /** Vêtements totaux obtenus. */
  totalGarments: number;
  /** Pièces totales obtenues (tous matelas). */
  totalPieces: number;
  /** Matelas dupliqués créés et remplis automatiquement. */
  duplicates: AutofillDuplicate[];
  /** Base du calcul rouleau : métrage, poids (grammage × largeur) ou aucune contrainte. */
  rollBasis: 'metrage' | 'poids' | 'aucun';
  /** Poids consommé par matelas (kg), null si grammage ou largeur inconnus. */
  weightPerMatelasKg: number | null;
}

export interface AutofillOptions {
  /**
   * Nombre de matelas (tables) voulu par l'utilisateur : override manuel
   * du nombre déduit du stock rouleau. Les duplicatas en trop sont
   * supprimés (brouillons uniquement), les manquants créés pleins.
   */
  targetMatelas?: number;
}

/**
 * Ne retient que les N premiers jeux complets d'un placement : pour
 * chaque pièce, on garde les qty × N instances les plus à gauche.
 * Un sous-ensemble d'un layout valide reste valide (retirer des pièces
 * ne crée jamais de chevauchement).
 */
function trimToSets(
  placements: OptimizerPlacement[],
  pieces: OptimizerPiece[],
  sets: number,
): OptimizerPlacement[] {
  const keep = new Map<number, number>(
    pieces.map((piece) => [piece.id, piece.qty * sets]),
  );
  const sorted = [...placements].sort((a, b) => a.x - b.x || a.y - b.y);
  const out: OptimizerPlacement[] = [];
  for (const placement of sorted) {
    const remaining = keep.get(placement.pieceId) ?? 0;
    if (remaining > 0) {
      out.push(placement);
      keep.set(placement.pieceId, remaining - 1);
    }
  }
  return out;
}

/** Ligne rouleau restreinte aux grandeurs utiles au calcul. */
interface RollStockRow {
  qty_unit: string | null;
  remaining_qty: number | null;
  remaining_weight_kg: number | null;
  grammage_g_m2: number | null;
  usable_width_cm: number | null;
}

export function autofillPlan(
  db: Database.Database,
  actor: Actor,
  planId: number,
  options: AutofillOptions = {},
): AutofillResult {
  assertCoupeWrite(actor);
  const plan = getPlan(db, Number(planId));
  if (plan.status === 'valide') {
    throw new ServiceError('Plan déjà validé : il est immuable.', 409);
  }
  const revisionId = readRevisionId(plan.input_json);
  if (revisionId === null) {
    throw new ServiceError('Plan sans révision de patron associée.', 409);
  }
  const revision = requireValidatedRevision(db, revisionId);
  const pieces: OptimizerPiece[] = revision.pieces
    .filter((piece) => piece.status === 'configuree')
    .map((piece) => ({
      id: piece.id,
      code: piece.code,
      label: piece.label,
      points: piece.points,
      qty: piece.qty,
      grainDirection: piece.grainDirection,
      allowedRotations: piece.allowedRotations,
      status: piece.status,
    }));
  if (pieces.length === 0) {
    throw new ServiceError('Aucune pièce configurée dans ce patron.', 409);
  }
  const piecesPerSet = pieces.reduce((sum, piece) => sum + piece.qty, 0);
  const layers = Math.max(1, Math.floor(plan.layers));
  const optimizerInput = {
    usableWidthCm: plan.usable_width_cm,
    maxLengthCm: plan.matelas_length_cm,
    gapCm: plan.gap_cm,
    pieces,
  };

  // 1. Capacité du matelas PLEIN : boucle progressive partagée
  // (cf. fill-matelas — départ optimiste par l'aire, ajustement par
  // passes jusqu'à saturation réelle du matelas).
  const fill = fillMatelas(optimizerInput);
  const raw = fill.result;
  const capacitySets = fill.capacitySets;
  if (capacitySets < 1) {
    throw new ServiceError(
      'Un seul jeu complet ne tient pas dans le matelas : augmentez la '
        + 'longueur du matelas ou vérifiez la largeur utilisable.',
      409,
    );
  }

  // 2. Contrainte ROULEAU : métrage et poids disponibles.
  const fabricPerMatelasM = (plan.matelas_length_cm / 100) * layers;
  const rollRow = plan.roll_id === null
    ? null
    : (db.prepare(
        'SELECT qty_unit, remaining_qty, remaining_weight_kg, '
        + 'grammage_g_m2, usable_width_cm FROM coupe_rolls WHERE id = ?',
      ).get(plan.roll_id) as RollStockRow | undefined) ?? null;
  const availableM = rollRow !== null
    && rollRow.qty_unit === 'm'
    && rollRow.remaining_qty !== null
    ? rollRow.remaining_qty
    : null;
  // Si le rouleau n'est suivi qu'en poids, le métrage est déduit du
  // grammage et de la largeur (jamais inventé : null si incomplet).
  const availableFromWeight = rollRow !== null
    && rollRow.remaining_weight_kg !== null
    && rollRow.grammage_g_m2 !== null
    && rollRow.usable_width_cm !== null
    ? (rollRow.remaining_weight_kg * 1000)
      / (rollRow.grammage_g_m2 * (rollRow.usable_width_cm / 100))
    : null;
  const rollAvailableM = availableM ?? availableFromWeight;

  // Matelas réalisables avec ce rouleau (le plan courant consomme le
  // premier). Borné à 1 si le stock rouleau est inconnu.
  const maxByLength = rollAvailableM !== null
    ? Math.max(1, Math.floor(rollAvailableM / fabricPerMatelasM))
    : 1;
  const weightPerMatelasKg = rollRow !== null
    && rollRow.grammage_g_m2 !== null
    && rollRow.usable_width_cm !== null
    ? fabricPerMatelasM * (rollRow.usable_width_cm / 100)
      * (rollRow.grammage_g_m2 / 1000)
    : null;
  const maxByWeight = weightPerMatelasKg !== null
    && rollRow?.remaining_weight_kg != null
    ? Math.max(1, Math.floor(rollRow.remaining_weight_kg / weightPerMatelasKg))
    : 1;
  const autoMatelas = Math.max(1, Math.min(maxByLength, maxByWeight));

  // Base de la contrainte rouleau (traçabilité interface).
  const rollBasis: 'metrage' | 'poids' | 'aucun' = availableM !== null
    ? 'metrage'
    : availableFromWeight !== null
      ? 'poids'
      : 'aucun';

  // Override manuel : le nombre de matelas voulu par l'utilisateur.
  // Borné par le stock rouleau QUAND il est connu ; sans stock fiable
  // (rouleau non suivi), l'utilisateur reste maître du nombre.
  const targetMatelas = options.targetMatelas;
  if (targetMatelas !== undefined
    && (!Number.isFinite(targetMatelas) || targetMatelas < 1 || targetMatelas > 500)) {
    throw new ServiceError('Nombre de matelas invalide (1 à 500).', 400);
  }
  if (targetMatelas !== undefined && rollBasis !== 'aucun' && targetMatelas > autoMatelas) {
    const raison = rollBasis === 'metrage'
      ? `métrage disponible ${rollAvailableM?.toFixed(1)} m`
      : `poids disponible ${rollRow?.remaining_weight_kg?.toFixed(2)} kg`;
    throw new ServiceError(
      `Impossible de dupliquer ${targetMatelas} matelas : le rouleau `
        + `(grammage ${rollRow?.grammage_g_m2 ?? '?'} g/m², largeur `
        + `${rollRow?.usable_width_cm ?? '?'} cm) permet au maximum `
        + `${autoMatelas} matelas pleins avec ${raison} `
        + `(${fabricPerMatelasM.toFixed(2)} m par matelas).`,
      409,
    );
  }
  const totalMatelas = targetMatelas ?? autoMatelas;

  const garmentsPerMatelas = capacitySets * layers;
  const setsOnPlan = capacitySets;
  const placements = trimToSets(raw.placements, pieces, setsOnPlan);

  // Validation géométrique serveur INDÉPENDANTE sur le layout retenu.
  const defects = validateCandidate(
    { ...optimizerInput, pieces: fill.scaledPieces },
    { ...raw, placements },
  );
  if (defects.length > 0) {
    throw new ServiceError(
      'Proposition de remplissage rejetée par la validation géométrique '
        + `serveur : ${defects.slice(0, 3).map((defect) => defect.message).join(' ; ')}`,
      500,
    );
  }

  // 3. Duplication : matelas 2..N créés PLEINS et enregistrés.
  // Les duplicatas d'un calcul précédent (tracés dans input_json du plan
  // source) sont conservés, complétés ou supprimés selon le total voulu.
  const duplicates: AutofillDuplicate[] = [];
  const previousIds = (readPlanInputJson(plan.input_json).autofillDuplicates ?? [])
    .filter((id) => Number.isInteger(id) && id > 0);
  const keptIds: number[] = [];
  const removedIds: number[] = [];
  if (totalMatelas > 1 || previousIds.length > 0) {
    if (plan.roll_id === null || plan.coupe_table_id === null) {
      throw new ServiceError(
        `Le calcul demande ${totalMatelas} matelas mais le plan n'a ni `
          + 'rouleau ni table assignés : assignez-les puis relancez.',
        409,
      );
    }
    // Réconciliation des duplicatas existants : un duplicata reste
    // valable s'il existe encore en brouillon non transféré ; les autres
    // sont retirés (en trop ou invalides).
    for (const id of previousIds) {
      if (keptIds.length >= totalMatelas - 1) {
        removedIds.push(id);
        continue;
      }
      const dup = db.prepare(
        "SELECT status, lot_id FROM marker_plans WHERE id = ?",
      ).get(id) as { status: string; lot_id: number | null } | undefined;
      if (dup && dup.status === 'proposition' && dup.lot_id === null) {
        keptIds.push(id);
      } else {
        removedIds.push(id);
      }
    }
    for (const id of removedIds) {
      try {
        deleteDraftPlan(db, actor, id);
      } catch {
        // Duplicata déjà validé ou référencé : il reste en place et
        // compte toujours comme un matelas réel (non supprimable).
        keptIds.push(id);
      }
    }
    const wastagePct = readPlanInputJson(plan.input_json).wastagePct ?? null;
    while (keptIds.length < totalMatelas - 1) {
      const created = createPlan(db, actor, {
        revisionId,
        rollId: plan.roll_id,
        tableId: plan.coupe_table_id,
        layers,
        gapCm: plan.gap_cm,
        matelasLengthCm: plan.matelas_length_cm,
        qty: 1,
        wastagePct,
      });
      savePlan(db, actor, created.id, trimToSets(raw.placements, pieces, capacitySets));
      keptIds.push(created.id);
    }
    // Traçabilité : la liste des duplicatas vivants est enregistrée dans
    // le plan source (recalculé à chaque calcul).
    patchPlanInputJson(db, plan.id, { autofillDuplicates: keptIds });
    for (const id of keptIds) duplicates.push({ planId: id, sets: capacitySets });
  }

  // Métriques recalculées sur le layout RÉELLEMENT retenu.
  const metrics = computeMetrics(
    placements.map((placement) => placement.points),
    plan.usable_width_cm,
    placements.length,
    0,
  );
  const totalGarments = totalMatelas * garmentsPerMatelas;
  return {
    placements,
    method: raw.method,
    metrics,
    piecesPerSet,
    setsOnPlan,
    capacitySets,
    layers,
    garmentsPerMatelas,
    piecesPerMatelas: garmentsPerMatelas * piecesPerSet,
    fabricPerMatelasM,
    rollAvailableM,
    rollRemainingAfterM: rollAvailableM !== null
      ? rollAvailableM - totalMatelas * fabricPerMatelasM
      : null,
    totalMatelas,
    totalGarments,
    totalPieces: totalGarments * piecesPerSet,
    duplicates,
    rollBasis,
    weightPerMatelasKg,
  };
}
