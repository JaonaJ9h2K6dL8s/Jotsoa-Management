import type { Point, Rect } from '@/lib/cutting/types';
import type { PieceDTO, PlanDTO, PlacementDTO } from '../api';

/**
 * Correspondance repère écran ↔ repère serveur.
 *
 * Le serveur borne l'axe X par la largeur utilisable du tissu et l'axe
 * Y par la longueur du matelas (plan.zone). Pour afficher la table
 * « allongée » horizontalement (expérience Canva), l'interface
 * travaille dans le repère transposé : X écran = longueur, Y écran =
 * largeur. La transposition est une réflexion isométrique : aires,
 * distances, inclusions et conflits sont conservés, à condition de
 * convertir aussi les rotations (90° ↔ 270°).
 */

export interface UIPiece {
  key: string;
  pieceId: number;
  code: string;
  label: string;
  x: number;
  y: number;
  rotation: number;
  points: Point[];
}

export function rotationToServer(rotation: number): number {
  return rotation === 90 ? 270 : rotation === 270 ? 90 : rotation;
}

export function rotationToUi(rotation: number): number {
  return rotationToServer(rotation);
}

/** Convertit un placement serveur vers le repère écran. */
export function placementToUi(placement: PlacementDTO, index: number): UIPiece {
  return {
    key: `p-${index}-${placement.pieceId}`,
    pieceId: placement.pieceId,
    code: placement.code,
    label: placement.label,
    x: placement.y,
    y: placement.x,
    rotation: rotationToUi(placement.rotation),
    points: placement.points.map((point) => ({ x: point.y, y: point.x })),
  };
}

/** Convertit un placement écran vers le format attendu par plan.save. */
export function placementToServer(piece: UIPiece): {
  pieceId: number;
  x: number;
  y: number;
  rotation: number;
  code: string;
} {
  return {
    pieceId: piece.pieceId,
    x: piece.y,
    y: piece.x,
    rotation: rotationToServer(piece.rotation),
    code: piece.code,
  };
}

/** Zone utilisable dans le repère écran (longueur en X, largeur en Y). */
export function uiZone(plan: PlanDTO): Rect {
  return {
    x: 0,
    y: 0,
    width: plan.matelas_length_cm,
    height: plan.usable_width_cm,
  };
}

/** Rotations autorisées côté écran (conversion des angles 90/270). */
export function uiAllowedRotations(piece: PieceDTO): number[] {
  return piece.allowedRotations.map(rotationToUi);
}

/** Dimensions écran d'une pièce à la rotation donnée (cm réels). */
export function uiPieceExtent(piece: PieceDTO, rotation: number): {
  width: number;
  height: number;
} {
  // Repère transposé : à rotation écran 0, la largeur de pièce (serveur
  // X) s'étend le long de la table (Y écran) et sa hauteur en travers.
  const swap = rotation === 0 || rotation === 180;
  return {
    width: swap ? piece.heightCm : piece.widthCm,
    height: swap ? piece.widthCm : piece.heightCm,
  };
}

/** Contour transformé (repère écran) pour l'affichage et la validation. */
export function uiContour(
  points: Point[],
  rotation: number,
  x: number,
  y: number,
): Point[] {
  // Transposition du plan = réflexion (x,y)→(y,x) du contour source,
  // puis rotation inverse (uiRotation = 360° − rotation serveur).
  const reflected = points.map((point) => ({ x: point.y, y: point.x }));
  const rotated = reflected.map((point) => {
    switch (rotation) {
      case 90: return { x: -point.y, y: point.x };
      case 180: return { x: -point.x, y: -point.y };
      case 270: return { x: point.y, y: -point.x };
      default: return { x: point.x, y: point.y };
    }
  });
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of rotated) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return rotated.map((point) => ({
    x: point.x - minX + x,
    y: point.y - minY + y,
  }));
}

/** Chemin SVG d'un contour (repère écran). */
export function pathOf(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return '';
  return `${points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ')} Z`;
}

/** Aire exacte d'un contour fermé (formule du lacet, cm², valeur absolue). */
export function polygonAreaCm2(points: Array<{ x: number; y: number }>): number {
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    sum += current.x * next.y - next.x * current.y;
  }
  return Math.abs(sum) / 2;
}

/** Boîte englobante écran des placements (cm) — null si aucun placement. */
export function placementBounds(
  placements: UIPiece[],
  extentOf: (item: UIPiece) => { width: number; height: number },
): { cx: number; cy: number; w: number; h: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const placement of placements) {
    const extent = extentOf(placement);
    minX = Math.min(minX, placement.x);
    minY = Math.min(minY, placement.y);
    maxX = Math.max(maxX, placement.x + extent.width);
    maxY = Math.max(maxY, placement.y + extent.height);
  }
  if (!Number.isFinite(minX)) return null;
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w: maxX - minX, h: maxY - minY };
}

/** Vue (viewBox écran) cadrant une boîte avec une marge en cm. */
export function viewForBounds(
  bounds: { cx: number; cy: number; w: number; h: number },
  rect: { width: number; height: number },
  paddingCm: number,
): { x: number; y: number; w: number } {
  const scale = Math.min(
    rect.width / (bounds.w + 2 * paddingCm),
    rect.height / (bounds.h + 2 * paddingCm),
  );
  const w = rect.width / scale;
  const h = rect.height / scale;
  return { x: bounds.cx - w / 2, y: bounds.cy - h / 2, w };
}
