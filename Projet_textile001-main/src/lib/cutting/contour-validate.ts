import type { Point } from './types';
import { polygonArea, segmentsIntersect } from './geometry';

/**
 * Validateur géométrique des contours de pièce (pur — aucun I/O).
 *
 * Autorité SERVEUR sur la validité d'un contour avant validation d'une
 * révision (et à l'import JSON) : jamais une décision du navigateur.
 * Un contour accepté ici est fermé (dernier point ≠ premier, fermeture
 * implicite), fini (coordonnées numériques), non dégénéré (aire
 * strictement positive, aucune arête de longueur nulle) et sans
 * auto-intersection. La boîte englobante peut être confrontée aux
 * dimensions de coupe déclarées.
 *
 * Tolérances : les sommets identiques au milliardième près sont
 * considérés identiques (coordonnées persistées arrondies au
 * centième). Les contacts AUTORISÉS ne sont jamais rejetés : sommets
 * partagés entre arêtes adjacentes et points alignés sur une arête
 * restent valides.
 */

export type ContourDefectCode =
  | 'trop_court'
  | 'coordonnees'
  | 'arrete_degeneree'
  | 'auto_intersection'
  | 'aire_nulle'
  | 'boite_incoherente';

export interface ContourDefect {
  code: ContourDefectCode;
  message: string;
}

export interface ContourOptions {
  /** Largeur de coupe déclarée (cm) — cohérence de la boîte englobante. */
  widthCm?: number;
  /** Hauteur de coupe déclarée (cm) — cohérence de la boîte englobante. */
  heightCm?: number;
  /** Tolérance de comparaison de la boîte (cm, défaut 1e-6). */
  toleranceCm?: number;
}

const POINT_EPSILON = 1e-9;

function samePoint(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) <= POINT_EPSILON && Math.abs(a.y - b.y) <= POINT_EPSILON;
}

function shareVertex(a1: Point, a2: Point, b1: Point, b2: Point): boolean {
  return samePoint(a1, b1) || samePoint(a1, b2) || samePoint(a2, b1) || samePoint(a2, b2);
}

/**
 * Auto-intersection d'un contour fermé : croisement entre deux arêtes
 * NON adjacentes. Les arêtes dégénérées (longueur nulle) sont ignorées
 * ici (signalées séparément), tout comme les sommets partagés entre
 * deux arêtes — contact géométrique autorisé d'un polygone simple.
 */
export function contourSelfIntersects(points: Point[]): boolean {
  const count = points.length;
  for (let first = 0; first < count; first += 1) {
    const a1 = points[first];
    const a2 = points[(first + 1) % count];
    if (samePoint(a1, a2)) continue;
    for (let second = first + 2; second < count; second += 1) {
      if (first === 0 && second === count - 1) continue;
      const b1 = points[second];
      const b2 = points[(second + 1) % count];
      if (samePoint(b1, b2)) continue;
      if (shareVertex(a1, a2, b1, b2)) continue;
      if (segmentsIntersect({ a: a1, b: a2 }, { a: b1, b: b2 })) return true;
    }
  }
  return false;
}

/** Validité complète d'un contour : liste des défauts (vide = valide). */
export function validateContourDefects(
  points: Point[],
  options: ContourOptions = {},
): ContourDefect[] {
  const defects: ContourDefect[] = [];
  if (!Array.isArray(points) || points.length < 3) {
    return [{ code: 'trop_court', message: 'contour trop court (3 sommets minimum)' }];
  }
  const badIndices: number[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      badIndices.push(index + 1);
    }
  }
  if (badIndices.length > 0) {
    defects.push({
      code: 'coordonnees',
      message: `coordonnées non numériques aux sommets ${badIndices.slice(0, 5).join(', ')}`,
    });
    return defects;
  }
  const degenerate: number[] = [];
  for (let index = 0; index < points.length; index += 1) {
    if (samePoint(points[index], points[(index + 1) % points.length])) {
      degenerate.push(index + 1);
    }
  }
  if (degenerate.length > 0) {
    defects.push({
      code: 'arrete_degeneree',
      message: `sommet répété (arête de longueur nulle) après le sommet `
        + `${degenerate.slice(0, 5).join(', ')}`,
    });
  }
  if (contourSelfIntersects(points)) {
    defects.push({ code: 'auto_intersection', message: 'contour auto-intersecté' });
  }
  if (polygonArea(points) <= POINT_EPSILON) {
    defects.push({ code: 'aire_nulle', message: 'contour dégénéré (aire nulle)' });
  }
  if (options.widthCm !== undefined || options.heightCm !== undefined) {
    const tolerance = options.toleranceCm ?? 1e-6;
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const width = Math.max(...xs) - Math.min(...xs);
    const height = Math.max(...ys) - Math.min(...ys);
    if (options.widthCm !== undefined
      && Math.abs(width - options.widthCm) > tolerance) {
      defects.push({
        code: 'boite_incoherente',
        message: `largeur du contour ${width.toFixed(2)} cm ≠ dimension de coupe `
          + `${options.widthCm.toFixed(2)} cm`,
      });
    }
    if (options.heightCm !== undefined
      && Math.abs(height - options.heightCm) > tolerance) {
      defects.push({
        code: 'boite_incoherente',
        message: `hauteur du contour ${height.toFixed(2)} cm ≠ dimension de coupe `
          + `${options.heightCm.toFixed(2)} cm`,
      });
    }
  }
  return defects;
}
