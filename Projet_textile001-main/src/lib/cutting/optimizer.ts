import type { GrainDirection, Point, Rotation } from './types';
import {
  bounds,
  grainPermittedRotations,
  polygonArea,
  transformContour,
} from './geometry';

/**
 * Optimiseur de placement (pur, sans I/O ni dépendance interface).
 *
 * Algorithme : « first-fit decreasing » par étagères (shelf packing)
 * sur les enveloppes (bounding boxes) des contours transformés.
 * - Les enveloppes ne se chevauchent jamais par construction, donc
 *   les contours réels (inclus dans leurs enveloppes) non plus.
 * - L'écart entre pièces (gapCm) est réservé autour de chaque
 *   enveloppe ; l'égalité exacte au gap reste acceptée par le
 *   contrôle serveur (polygonsConflict : distance < gap = conflit).
 * - Heuristique déterministe SANS garantie d'optimum global.
 * Unité unique : le centimètre réel. Repère serveur :
 * X = largeur utilisable du tissu, Y = longueur du matelas.
 */

const EPSILON = 1e-6;

export interface OptimizerPiece {
  id: number;
  code: string;
  label: string;
  points: Point[];
  qty: number;
  grainDirection: GrainDirection;
  allowedRotations: number[];
  /** 'incomplete' → exclue de l'optimisation de production. */
  status: 'configuree' | 'incomplete';
}

export interface OptimizerInput {
  usableWidthCm: number;
  maxLengthCm: number;
  gapCm: number;
  pieces: OptimizerPiece[];
  /** Tissu « sens unique » : interdit le retournement à 180°. */
  oneWayFabric?: boolean;
}

export interface OptimizerPlacement {
  pieceId: number;
  code: string;
  label: string;
  x: number;
  y: number;
  rotation: Rotation;
  /** Contour transformé (coordonnées absolues, cm). */
  points: Point[];
}

export interface OptimizerUnplaced {
  code: string;
  label: string;
  quantity: number;
  reason: string;
}

export interface OptimizerMetrics {
  /** Longueur de tissu réellement consommée par le placement (cm). */
  consumedLengthCm: number;
  /** Largeur utilisable prise en compte (cm). */
  usableWidthCm: number;
  /** Somme des aires des pièces placées (m²). */
  piecesAreaM2: number;
  /** Aire de la bande consommée = largeur × longueur consommée (m²). */
  consumedAreaM2: number;
  /** Chutes géométriques = consommée − pièces (m²). */
  wasteAreaM2: number;
  /** Taux d'utilisation GÉOMÉTRIQUE (0–100), pas le rendement industriel. */
  utilizationPct: number;
  placedCount: number;
  unplacedCount: number;
}

export interface OptimizerResult {
  placements: OptimizerPlacement[];
  unplaced: OptimizerUnplaced[];
  metrics: OptimizerMetrics;
  /** Indicateur d'algorithme (aucune promesse d'optimalité). */
  method: 'shelf-ffd' | 'nest-blf';
  /** Temps de calcul total mesuré (ms) — renseigné par la méthode combinée. */
  computeMs?: number;
  /** Compteurs de recherche du nesting (transparence, non contractuels). */
  stats?: {
    candidatesTested: number;
    exactTests: number;
    /** true si le budget a interrompu la recherche. */
    expired: boolean;
  };
  /** Statistiques de la recherche locale (retenue ou tentée). */
  improve?: {
    movesAccepted: number;
    exactTests: number;
    passes: number;
    expired: boolean;
  };
  /** true si le candidat local a été retenu dans la proposition finale. */
  improveApplied?: boolean;
  /** Durées mesurées par phase de la stratégie combinée (ms). */
  phaseMs?: { shelfFfd: number; nestBlf: number; localImprove: number };
  /** true si la recherche a atteint son budget de calcul. */
  budgetExpired?: boolean;
  /** true si shelf-ffd a servi de repli après une recherche BLF interrompue. */
  fallbackUsed?: boolean;
  /** Candidates comparées par le moteur multi-stratégies (étape 16). */
  candidates?: CandidateSummary[];
}

export interface Orientation { rotation: Rotation; w: number; h: number; points: Point[] }

/** Résumé d'une strategy candidate comparée par le moteur (étape 16). */
export interface CandidateSummary {
  /** Nom identifiable de la stratégie (ex. shelf-ffd, nest-blf+local). */
  strategy: string;
  /** Quantité de pièces non placées par cette candidate. */
  unplaced: number;
  /** Longueur consommée (cm, arrondie au dixième). */
  consumedLengthCm: number;
  /** true pour la candidate retenue dans la proposition finale. */
  retained: boolean;
}

interface Item {
  pieceId: number;
  code: string;
  label: string;
  orientations: Orientation[];
  minH: number;
  maxW: number;
}

/** Aire d'une pièce source en m² (contour exact, sans transformation). */
export function pieceAreaM2(points: Point[]): number {
  return polygonArea(points) / 10000;
}

/**
 * Indicateurs d'un placement existant (plan courant ou proposition).
 * Formules :
 * - longueur consommée = max(y + hauteur d'enveloppe) sur les pièces ;
 * - surface pièces = Σ aire exacte du contour (m²) ;
 * - surface consommée = largeur utile × longueur consommée (m²) ;
 * - chutes = surface consommée − surface pièces (m²) ;
 * - taux d'utilisation = surface pièces / surface consommée × 100.
 * Aucune pièce placée → indicateurs nuls (pas de division par zéro).
 */
export function computeMetrics(
  contours: Point[][],
  usableWidthCm: number,
  placedCount = contours.length,
  unplacedCount = 0,
): OptimizerMetrics {
  let consumedLength = 0;
  let piecesAreaM2 = 0;
  for (const contour of contours) {
    if (contour.length < 3) continue;
    const box = bounds(contour);
    consumedLength = Math.max(consumedLength, box.maxY);
    piecesAreaM2 += polygonArea(contour) / 10000;
  }
  const consumedAreaM2 = (usableWidthCm * consumedLength) / 10000;
  const wasteAreaM2 = Math.max(0, consumedAreaM2 - piecesAreaM2);
  return {
    consumedLengthCm: consumedLength,
    usableWidthCm,
    piecesAreaM2,
    consumedAreaM2,
    wasteAreaM2,
    utilizationPct: consumedAreaM2 > 0 ? (piecesAreaM2 / consumedAreaM2) * 100 : 0,
    placedCount,
    unplacedCount,
  };
}

/** Pertes en kg : chutes (m²) × grammage (g/m²) / 1000 ; null si grammage absent. */
export function wasteKg(wasteAreaM2: number, grammageGm2: number | null): number | null {
  if (grammageGm2 === null || grammageGm2 <= 0) return null;
  return (wasteAreaM2 * grammageGm2) / 1000;
}

/**
 * Orientations permises d'une pièce (droit-fil + rotations déclarées +
 * largeur utilisable). Exportée pour le nesting sur contours réels.
 */
export function permittedOrientations(
  piece: OptimizerPiece,
  usableWidthCm: number,
  _gapCm: number,
  oneWayFabric: boolean,
): { orientations: Orientation[]; reason: string | null } {
  const permitted = grainPermittedRotations(
    piece.grainDirection,
    piece.allowedRotations,
    oneWayFabric,
  );
  const orientations: Orientation[] = [];
  for (const rotation of permitted) {
    const points = transformContour(piece.points, rotation as Rotation, 0, 0);
    const box = bounds(points);
    const w = box.maxX - box.minX;
    const h = box.maxY - box.minY;
    if (w <= usableWidthCm) {
      orientations.push({ rotation: rotation as Rotation, w, h, points });
    }
  }
  if (orientations.length > 0) {
    return { orientations, reason: null };
  }
  const rawWidth = bounds(piece.points);
  const pieceW = rawWidth.maxX - rawWidth.minX;
  const pieceH = rawWidth.maxY - rawWidth.minY;
  const reason = permitted.length === 0
    ? `Aucune rotation autorisée pour ${piece.label} (droit-fil ${piece.grainDirection}).`
    : `Largeur du tissu insuffisante pour ${piece.label} `
      + `(${Math.min(pieceW, pieceH).toFixed(1)} cm minimum requis `
      + `pour ${usableWidthCm.toFixed(1)} cm disponibles).`;
  return { orientations, reason };
}

/**
 * Placement automatique par étagères (FFD). Les pièces incomplètes
 * sont exclues et restituées avec le motif exact. Toutes les pièces
 * d'un même patron sont multipliées par leur quantité requise.
 */
export function optimizePlacement(input: OptimizerInput): OptimizerResult {
  const { usableWidthCm, maxLengthCm, gapCm, oneWayFabric = false } = input;
  const placements: OptimizerPlacement[] = [];
  const unplaced: OptimizerUnplaced[] = [];
  const items: Item[] = [];

  for (const piece of input.pieces) {
    const qty = Number.isFinite(piece.qty) ? Math.max(0, Math.floor(piece.qty)) : 0;
    if (piece.status === 'incomplete' || piece.points.length < 3) {
      if (qty > 0) {
        unplaced.push({
          code: piece.code,
          label: piece.label,
          quantity: qty,
          reason: `Pièce ${piece.label} non configurée : exclue de la coupe réelle.`,
        });
      }
      continue;
    }
    const { orientations, reason } = permittedOrientations(piece, usableWidthCm, gapCm, oneWayFabric);
    if (orientations.length === 0) {
      unplaced.push({ code: piece.code, label: piece.label, quantity: qty, reason: reason ?? 'Placement impossible.' });
      continue;
    }
    for (let copy = 0; copy < qty; copy += 1) {
      items.push({
        pieceId: piece.id,
        code: piece.code,
        label: piece.label,
        orientations,
        minH: Math.min(...orientations.map((o) => o.h)),
        maxW: Math.max(...orientations.map((o) => o.w)),
      });
    }
  }

  // Tri déterministe : hauteur minimale décroissante, puis largeur,
  // puis code (stabilité totale d'une exécution à l'autre).
  items.sort((a, b) => b.minH - a.minH || b.maxW - a.maxW || a.code.localeCompare(b.code));

  let cursorX = 0;
  let cursorY = 0;
  let rowHeight = 0;

  for (const item of items) {
    const candidates = [...item.orientations].sort((a, b) => a.h - b.h || b.w - a.w);
    const fitsHere = candidates.find((o) => cursorX + o.w <= usableWidthCm + EPSILON);
    let chosen: Orientation | null = null;
    let placeX = 0;
    let placeY = 0;
    if (fitsHere && cursorY + Math.max(rowHeight, fitsHere.h) <= maxLengthCm + EPSILON) {
      chosen = fitsHere;
      placeX = cursorX;
      placeY = cursorY;
    } else {
      // Nouvelle étagère : ferme la rangée courante (hauteur remise à zéro).
      const nextY = cursorY + rowHeight + gapCm;
      const smallest = candidates[0];
      if (nextY + smallest.h > maxLengthCm + EPSILON) {
        unplaced.push({
          code: item.code,
          label: item.label,
          quantity: 1,
          reason: `Longueur de tissu insuffisante pour ${item.label} `
            + `(besoin ≈ ${(nextY + smallest.h).toFixed(0)} cm, `
            + `disponible ${maxLengthCm.toFixed(0)} cm).`,
        });
        continue;
      }
      chosen = smallest;
      placeX = 0;
      placeY = nextY;
      rowHeight = 0;
    }
    // chosen.points est déjà le contour transformé (rotation appliquée
    // et normalisée à l'origine) : le placement n'ajoute que la
    // translation. Une seconde rotation fausserait la géométrie.
    const points = chosen.points.map((point) => ({
      x: point.x + placeX,
      y: point.y + placeY,
    }));
    placements.push({
      pieceId: item.pieceId,
      code: item.code,
      label: item.label,
      x: placeX,
      y: placeY,
      rotation: chosen.rotation,
      points,
    });
    cursorX = placeX + chosen.w + gapCm;
    rowHeight = Math.max(rowHeight, chosen.h);
    cursorY = placeY;
  }

  const metrics = computeMetrics(
    placements.map((placement) => placement.points),
    usableWidthCm,
    placements.length,
    unplaced.reduce((sum, item) => sum + item.quantity, 0),
  );
  return { placements, unplaced, metrics, method: 'shelf-ffd' };
}
