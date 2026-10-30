import type Database from 'better-sqlite3';
import { ServiceError } from '@/server/api/service-error';
import type { Actor } from '@/server/users/users-service';
import type { OptimizerResult, OptimizerPiece, OptimizerPlacement } from '@/lib/cutting/optimizer';
import { wasteKg, computeMetrics } from '@/lib/cutting/optimizer';
import { optimizePlacementBest } from '@/lib/cutting/best-placement';
import { fillMatelas } from '@/lib/cutting/fill-matelas';
import { validateCandidate } from '@/lib/cutting/nesting-validate';
import { getPlan, readRevisionId } from './plans';
import { requireValidatedRevision } from './patterns';
import { assertCoupeWrite } from './common';

/**
 * Optimisation de placement d'un plan existant (service pur côté
 * serveur, SANS écriture) : la proposition est calculée depuis la
 * révision validée associée au plan et les contraintes réelles du
 * plan (largeur utilisable du tissu, longueur de matelas, gap).
 *
 * L'optimiseur REMPLIT TOUT LE MATÉLAS : le patron est répété en jeux
 * complets (aucun jeu incomplet — une pièce orpheline ne produit pas
 * de vêtement) jusqu'à saturation de la longueur de matelas.
 * Le résultat ne devient le plan courant qu'après acceptation
 * explicite dans l'interface, puis recontrôle `plan.verify` et
 * sauvegarde volontaire.
 */

/** Ne garde que les N premiers jeux complets (instances les plus à gauche). */
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

export interface OptimizeProposal extends OptimizerResult {
  planId: number;
  revisionId: number;
  /** Pertes estimées en kg (null → « estimation indisponible »). */
  wasteKg: number | null;
  grammageGm2: number | null;
  /** Longueur disponible prise en compte (matelas, cm). */
  availableLengthCm: number;
  /** Jeux complets du patron placés sur le matelas (calcul auto). */
  setsCount: number;
  /** Pièces par jeu complet (ex. polo = 6). */
  piecesPerSet: number;
  /** Couches de tissu du plan. */
  layers: number;
  /** Vêtements obtenus = jeux × couches. */
  garmentsTotal: number;
  /** Pièces coupées obtenues = vêtements × pièces par jeu. */
  piecesTotal: number;
}

interface RollFabricInfo {
  grammage_g_m2: number | null;
  usable_width_cm: number | null;
  width_cm: number | null;
}

export function optimizePlan(
  db: Database.Database,
  actor: Actor,
  planId: number,
): OptimizeProposal {
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
  const pieces: OptimizerPiece[] = revision.pieces.map((piece) => ({
    id: piece.id,
    code: piece.code,
    label: piece.label,
    points: piece.points,
    qty: piece.qty,
    grainDirection: piece.grainDirection,
    allowedRotations: piece.allowedRotations,
    status: piece.status,
  }));
  const unconfiguredCount = (revision.unconfigured ?? []).length;
  const piecesPerSet = pieces
    .filter((piece) => piece.status === 'configuree')
    .reduce((sum, piece) => sum + piece.qty, 0);
  // Meilleure solution valide : référence shelf-ffd comparée au
  // nesting BLF sur les contours réels (score documenté : non placées,
  // puis longueur consommée). Budget de calcul borné côté service.
  const optimizerInput = {
    usableWidthCm: plan.usable_width_cm,
    maxLengthCm: plan.matelas_length_cm,
    gapCm: plan.gap_cm,
    pieces,
  };
  // REMPLISSAGE COMPLET (tous les patrons) : boucle progressive —
  // départ optimiste par l'aire, réduction si la passe expire,
  // croissance tant que le matelas garde de la marge. Seuls les jeux
  // COMPLETS sont retenus (aucune pièce orpheline).
  const fill = fillMatelas(optimizerInput);
  const capacitySets = fill.capacitySets;
  let result: OptimizerResult;
  if (capacitySets >= 1) {
    const trimmed = trimToSets(fill.result.placements, pieces, capacitySets);
    // Validation géométrique serveur INDÉPENDANTE sur le layout retenu
    // (échec interne jamais silencieux).
    const defects = validateCandidate(
      { ...optimizerInput, pieces: fill.scaledPieces },
      { ...fill.result, placements: trimmed },
    );
    if (defects.length > 0) {
      throw new ServiceError(
        'Proposition d’optimisation rejetée par la validation géométrique '
          + `serveur : ${defects.slice(0, 3).map((defect) => defect.message).join(' ; ')}`,
        500,
      );
    }
    result = {
      ...fill.result,
      placements: trimmed,
      // Jeux complets uniquement : rien d'orphelin à signaler.
      unplaced: [],
      metrics: computeMetrics(
        trimmed.map((placement) => placement.points),
        plan.usable_width_cm,
        trimmed.length,
        0,
      ),
    };
  } else {
    // Repli : un seul jeu (comportement historique).
    const single = optimizePlacementBest(optimizerInput);
    const defects = validateCandidate(optimizerInput, single);
    if (defects.length > 0) {
      throw new ServiceError(
        'Proposition d’optimisation rejetée par la validation géométrique '
          + `serveur : ${defects.slice(0, 3).map((defect) => defect.message).join(' ; ')}`,
        500,
      );
    }
    result = single;
  }
  for (const missing of revision.unconfigured ?? []) {
    result.unplaced.push({
      code: missing.code,
      label: missing.label,
      quantity: 1,
      reason: `Pièce ${missing.label} à configurer (mesures manquantes : `
        + `${missing.missingLabels.join(', ')}) : exclue de la coupe réelle.`,
    });
  }
  result.metrics.unplacedCount += unconfiguredCount;

  const rollInfo = plan.roll_id === null
    ? null
    : db.prepare(
      'SELECT grammage_g_m2, usable_width_cm, width_cm FROM coupe_rolls WHERE id = ?',
    ).get(plan.roll_id) as RollFabricInfo | undefined;
  const grammage = rollInfo?.grammage_g_m2 ?? null;
  const usableKnown = rollInfo === undefined || rollInfo === null
    ? true
    : (rollInfo.usable_width_cm ?? rollInfo.width_cm) !== null;
  const waste = usableKnown && grammage !== null
    ? wasteKg(result.metrics.wasteAreaM2, grammage)
    : null;
  return {
    ...result,
    planId: plan.id,
    revisionId,
    wasteKg: waste,
    grammageGm2: grammage,
    availableLengthCm: plan.matelas_length_cm,
    setsCount: capacitySets >= 1 ? capacitySets : 1,
    piecesPerSet,
    layers: Math.max(1, Math.floor(plan.layers)),
    garmentsTotal: (capacitySets >= 1 ? capacitySets : 1)
      * Math.max(1, Math.floor(plan.layers)),
    piecesTotal: (capacitySets >= 1 ? capacitySets : 1)
      * Math.max(1, Math.floor(plan.layers)) * piecesPerSet,
  };
}
