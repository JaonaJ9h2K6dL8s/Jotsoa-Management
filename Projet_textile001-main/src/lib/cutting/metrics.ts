import type { Point } from './types';
import { polygonArea } from './geometry';
import type { OptimizerMetrics } from './optimizer';

/**
 * Métriques et quantités dérivées du placement réel (pur, sans I/O).
 * Formules (unité unique : centimètre ; aires converties en m²) :
 * - longueur occupée = max(y + emprise) des contours placés (jamais
 *   saisie manuellement) ;
 * - surface consommée = largeur utile × longueur occupée (cm² → m²) ;
 * - surface des pièces = Σ aire exacte des contours (cm² → m²) ;
 * - chutes = surface consommée − surface des pièces (m²) ;
 * - taux d'utilisation = pièces ÷ consommée × 100 ;
 * - taux de perte géométrique estimée = 100 − taux d'utilisation
 *   (identique à chutes ÷ consommée × 100).
 * Le taux d'utilisation est GÉOMÉTRIQUE : ce n'est pas le rendement
 * industriel réel (couches, défauts tissu, extrémités non modélisés).
 */

/** Ligne de suivi des quantités d'une pièce (base du transfert Couture). */
export interface QuantityRow {
  pieceId: number;
  code: string;
  label: string;
  /** Catégorie de pièce (devant, dos, manche…). */
  component: string;
  /** Quantité requise par la révision du patron. */
  expected: number;
  /** Occurrences placées sur le canvas (placement virtuel, non coupé). */
  placed: number;
  /** Occurrences placées sans violation géométrique détectée. */
  valid: number;
  /** Occurrences placées en position invalide. */
  invalid: number;
  /** Quantité requise non encore placée (jamais négative). */
  missing: number;
}

export interface PlacementSummary {
  rows: QuantityRow[];
  model: { expected: number; placed: number; valid: number; invalid: number; missing: number };
  /** true si tout ce qui est requis est placé et valide. */
  readyForTransfer: boolean;
}

export interface ExpectedPiece {
  pieceId: number;
  code: string;
  label: string;
  component: string;
  qty: number;
  /** 'incomplete' → jamais comptée comme coupable. */
  status: 'configuree' | 'incomplete';
}

/**
 * Quantités attendues / placées / valides / manquantes par pièce.
 * - attendues : qty de la définition (0 pour une pièce incomplète,
 *   qui reste listée avec expected 0 et un motif dans l'interface) ;
 * - invalides : occurrences en violation (décompte exact par pièce) ;
 * - valides : placées − invalides ;
 * - manquantes : attendues − placées (borné à 0, les surplus restent
 *   visibles via `placed > expected`).
 */
export function summarizePlacement(
  expected: ExpectedPiece[],
  placedCounts: Map<number, number>,
  invalidCounts: Map<number, number>,
): PlacementSummary {
  const rows: QuantityRow[] = expected.map((piece) => {
    const placed = placedCounts.get(piece.pieceId) ?? 0;
    const expectedQty = piece.status === 'incomplete' ? 0 : Math.max(0, Math.floor(piece.qty));
    const invalidCount = Math.min(placed, invalidCounts.get(piece.pieceId) ?? 0);
    return {
      pieceId: piece.pieceId,
      code: piece.code,
      label: piece.label,
      component: piece.component,
      expected: expectedQty,
      placed,
      valid: placed - invalidCount,
      invalid: invalidCount,
      missing: Math.max(0, expectedQty - placed),
    };
  });
  const model = rows.reduce(
    (acc, row) => ({
      expected: acc.expected + row.expected,
      placed: acc.placed + row.placed,
      valid: acc.valid + row.valid,
      invalid: acc.invalid + row.invalid,
      missing: acc.missing + row.missing,
    }),
    { expected: 0, placed: 0, valid: 0, invalid: 0, missing: 0 },
  );
  return { rows, model, readyForTransfer: model.expected > 0 && model.missing === 0 && model.invalid === 0 };
}

/** Somme des aires exactes des contours placés, en m². */
export function placedAreaM2(contours: Point[][]): number {
  let total = 0;
  for (const contour of contours) {
    if (contour.length < 3) continue;
    total += polygonArea(contour) / 10000;
  }
  return total;
}

/** Taux de perte géométrique estimée (%) — cohérent avec computeMetrics. */
export function wastePctOf(metrics: OptimizerMetrics): number {
  if (metrics.consumedAreaM2 <= 0) return 0;
  return Math.max(0, 100 - metrics.utilizationPct);
}

/** Longueur occupée recalculée depuis les contours persistés (cm). */
export function maxPersistedLengthCm(
  placements: Array<{ points: Point[] }>,
): number {
  let length = 0;
  for (const placement of placements) {
    for (const point of placement.points) {
      if (point.y > length) length = point.y;
    }
  }
  return length;
}

/** Tolérance explicite de cohérence des métriques enregistrées (cm). */
export const MARKER_TOLERANCE_CM = 1;

export interface MarkerCoherence {
  /** true → écart au-delà de la tolérance (avertissement affiché). */
  stale: boolean;
  /** Écart absolu enregistré / recalculé, en cm. */
  deltaCm: number;
}

/**
 * Compare la longueur enregistrée à la longueur recalculée des contours
 * persistés. Un écart au-delà de la tolérance signale un plan dont les
 * métriques datent d'une ancienne convention (longueur du matelas
 * déclaré) — la différence N'EST PAS en soi une corruption : la version
 * de la convention utilisée lors de l'enregistrement n'est pas
 * enregistrée en base et ne peut pas être déterminée rétroactivement.
 */
export function checkMarkerCoherence(
  persistedLengthCm: number,
  recalculatedLengthCm: number,
  toleranceCm: number = MARKER_TOLERANCE_CM,
): MarkerCoherence {
  const deltaCm = Math.abs(persistedLengthCm - recalculatedLengthCm);
  return { stale: deltaCm > toleranceCm, deltaCm };
}
