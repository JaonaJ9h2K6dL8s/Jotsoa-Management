import type { OptimizerInput, OptimizerResult } from './optimizer';
import {
  bounds,
  grainPermittedRotations,
  insideRect,
  polygonsConflictFast,
} from './geometry';

/**
 * Validation géométrique INDÉPENDANTE d'une solution candidate
 * (pur, sans I/O — étape 16). Ne fait confiance à aucun algorithme de
 * construction : chaque placement est recontrôlé sur les contours
 * réels — coordonnées finies, surface utile respectée, rotation et
 * droit-fil permis, aucun chevauchement (gap exact), bilan intégral
 * placées + non placées = quantité attendue. Les bounding boxes ne
 * servent qu'au préfiltrage interne de `polygonsConflictFast` : la
 * décision reste géométrique.
 */

export interface CandidateDefect {
  code: 'coordonnees' | 'hors_zone' | 'rotation' | 'chevauchement' | 'bilan';
  message: string;
}

export function validateCandidate(
  input: OptimizerInput,
  result: OptimizerResult,
): CandidateDefect[] {
  const defects: CandidateDefect[] = [];
  const zone = { x: 0, y: 0, width: input.usableWidthCm, height: input.maxLengthCm };
  for (const placement of result.placements) {
    if (!Number.isFinite(placement.x) || !Number.isFinite(placement.y)
      || placement.points.some(
        (point) => !Number.isFinite(point.x) || !Number.isFinite(point.y),
      )) {
      defects.push({
        code: 'coordonnees',
        message: `${placement.label} : coordonnées non finies`,
      });
      continue;
    }
    if (!insideRect(placement.points, zone)) {
      defects.push({
        code: 'hors_zone',
        message: `${placement.label} : hors de la surface utile`,
      });
    }
    const source = input.pieces.find((piece) => piece.id === placement.pieceId);
    const permitted = source
      ? grainPermittedRotations(
        source.grainDirection, source.allowedRotations, input.oneWayFabric ?? false,
      )
      : [];
    if (!permitted.includes(placement.rotation)) {
      defects.push({
        code: 'rotation',
        message: `${placement.label} : rotation ${placement.rotation}° interdite `
          + `(droit-fil ${source?.grainDirection ?? '?'})`,
      });
    }
  }
  const placements = result.placements;
  for (let first = 0; first < placements.length; first += 1) {
    for (let second = first + 1; second < placements.length; second += 1) {
      if (polygonsConflictFast(
        placements[first].points, placements[second].points, input.gapCm,
      )) {
        defects.push({
          code: 'chevauchement',
          message: `${placements[first].label} / ${placements[second].label} `
            + ': chevauchement ou gap non respecté',
        });
      }
    }
  }
  const expected = input.pieces.reduce(
    (sum, piece) => sum + Math.max(0, Math.floor(Number.isFinite(piece.qty) ? piece.qty : 0)), 0,
  );
  const unplaced = result.unplaced.reduce((sum, item) => sum + item.quantity, 0);
  if (placements.length + unplaced !== expected) {
    defects.push({
      code: 'bilan',
      message: `bilan incohérent : ${placements.length} placées + ${unplaced} `
        + `non placées ≠ ${expected} attendues`,
    });
  }
  return defects;
}

/** Somme des non placées d'une candidate (quantités). */
export function candidateUnplaced(result: OptimizerResult): number {
  return result.unplaced.reduce((sum, item) => sum + item.quantity, 0);
}

/** Empreinte de boîte maximale (diagnostic, cm). */
export function candidateTop(result: OptimizerResult): number {
  let top = 0;
  for (const placement of result.placements) {
    top = Math.max(top, bounds(placement.points).maxY);
  }
  return top;
}
