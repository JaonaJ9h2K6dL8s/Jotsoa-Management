import type Database from 'better-sqlite3';
import { ServiceError } from '@/server/api/service-error';
import type { Actor } from '@/server/users/users-service';
import type { OptimizerResult } from '@/lib/cutting/optimizer';
import type { OptimizerPiece } from '@/lib/cutting/optimizer';
import { wasteKg } from '@/lib/cutting/optimizer';
import { optimizePlacementBest } from '@/lib/cutting/best-placement';
import { validateCandidate } from '@/lib/cutting/nesting-validate';
import { getPlan, readRevisionId } from './plans';
import { requireValidatedRevision } from './patterns';
import { assertCoupeWrite } from './common';

/**
 * Optimisation de placement d'un plan existant (service pur côté
 * serveur, SANS écriture) : la proposition est calculée depuis la
 * révision validée associée au plan et les contraintes réelles du
 * plan (largeur utilisable du tissu, longueur de matelas, gap).
 * Le résultat ne devient le plan courant qu'après acceptation
 * explicite dans l'interface, puis recontrôle `plan.verify` et
 * sauvegarde volontaire.
 */

export interface OptimizeProposal extends OptimizerResult {
  planId: number;
  revisionId: number;
  /** Pertes estimées en kg (null → « estimation indisponible »). */
  wasteKg: number | null;
  grammageGm2: number | null;
  /** Longueur disponible prise en compte (matelas, cm). */
  availableLengthCm: number;
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
  // Meilleure solution valide : référence shelf-ffd comparée au
  // nesting BLF sur les contours réels (score documenté : non placées,
  // puis longueur consommée). Budget de calcul borné côté service.
  const optimizerInput = {
    usableWidthCm: plan.usable_width_cm,
    maxLengthCm: plan.matelas_length_cm,
    gapCm: plan.gap_cm,
    pieces,
  };
  const result = optimizePlacementBest(optimizerInput);
  // Validation géométrique serveur INDÉPENDANTE (étape 16) : la
  // proposition est recontrôlée sur les contours réels avant d'être
  // présentée. Aucune confiance aveugle dans l'algorithme de
  // construction ; un échec interne n'est jamais silencieux.
  const defects = validateCandidate(optimizerInput, result);
  if (defects.length > 0) {
    throw new ServiceError(
      'Proposition d’optimisation rejetée par la validation géométrique '
        + `serveur : ${defects.slice(0, 3).map((defect) => defect.message).join(' ; ')}`,
      500,
    );
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
  };
}
