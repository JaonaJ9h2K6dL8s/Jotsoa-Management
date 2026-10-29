import type { Box, GrainDirection, Point, Rect, Rotation } from './types';

/**
 * Géométrie 2D pure du module Coupe (aucune dépendance, aucun I/O).
 *
 * Même implémentation côté client (validation temps réel, contour
 * rouge) et côté serveur (autorité finale sur les actions critiques).
 * Unité unique : le centimètre réel. Les rotations sont limitées aux
 * multiples de 90° afin de rester exactes (aucune approximation
 * trigonométrique).
 */

export function bounds(points: Point[]): Box {
  if (!points.length) {
    throw new Error('Contour vide : impossible de calculer l\'enveloppe.');
  }
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

/** Rotation exacte autour de l'origine (multiples de 90° uniquement). */
export function rotatePoint(point: Point, rotation: Rotation): Point {
  switch (rotation) {
    case 90: return { x: -point.y, y: point.x };
    case 180: return { x: -point.x, y: -point.y };
    case 270: return { x: point.y, y: -point.x };
    default: return { x: point.x, y: point.y };
  }
}

/**
 * Contour transformé pour un placement : rotation puis translation
 * afin que le coin supérieur gauche de l'enveloppe tournée tombe
 * exactement sur (x, y). Le contour source n'est jamais modifié.
 */
export function transformContour(points: Point[], rotation: Rotation, x = 0, y = 0): Point[] {
  const rotated = points.map((point) => rotatePoint(point, rotation));
  const box = bounds(rotated);
  return rotated.map((point) => ({ x: point.x - box.minX + x, y: point.y - box.minY + y }));
}

/** Aire signée d'un polygone (valeur absolue), unités du contour. */
export function polygonArea(points: Point[]): number {
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    sum += current.x * next.y - next.x * current.y;
  }
  return Math.abs(sum) / 2;
}

export function pointInPolygon(point: Point, polygon: Point[], ox = 0, oy = 0): boolean {
  const px = point.x + ox;
  const py = point.y + oy;
  let inside = false;
  for (let index = 0, j = polygon.length - 1; index < polygon.length; j = index, index += 1) {
    const a = polygon[index];
    const b = polygon[j];
    const crosses = (a.y > py) !== (b.y > py);
    if (crosses && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** Point translaté testé contre un polygone fixe (zéro allocation). */
function pointInPolygonOffset(
  point: Point, polygon: Point[], ox: number, oy: number,
): boolean {
  if (ox === 0 && oy === 0) return pointInPolygon(point, polygon);
  return pointInPolygon(point, polygon, ox, oy);
}

interface Segment { a: Point; b: Point }

const EPSILON = 1e-9;

function pointSegmentDistance(point: Point, segment: Segment): number {
  return pointSegmentDistanceSq2(point.x, point.y, segment.a.x, segment.a.y, segment.b.x, segment.b.y);
}

/** Distance point→segment sans allocation (coordonnées à plat). */
function pointSegmentDistanceSq2(
  px: number, py: number, ax: number, ay: number, bx: number, by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return Math.hypot(px - ax, py - ay);
  }
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function orientation(a: Point, b: Point, c: Point): number {
  const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  if (Math.abs(cross) <= EPSILON) return 0;
  return cross > 0 ? 1 : 2;
}

function onSegment(point: Point, start: Point, end: Point): boolean {
  return Math.abs(orientation(start, end, point)) === 0
    && Math.min(start.x, end.x) - EPSILON <= point.x && point.x <= Math.max(start.x, end.x) + EPSILON
    && Math.min(start.y, end.y) - EPSILON <= point.y && point.y <= Math.max(start.y, end.y) + EPSILON;
}

/** Intersection effective de deux segments (contact inclus). */
export function segmentsIntersect(first: Segment, second: Segment): boolean {
  const { a: p1, b: p2 } = first;
  const { a: p3, b: p4 } = second;
  const o1 = orientation(p1, p2, p3);
  const o2 = orientation(p1, p2, p4);
  const o3 = orientation(p3, p4, p1);
  const o4 = orientation(p3, p4, p2);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(p3, p1, p2)) return true;
  if (o2 === 0 && onSegment(p4, p1, p2)) return true;
  if (o3 === 0 && onSegment(p1, p3, p4)) return true;
  if (o4 === 0 && onSegment(p2, p3, p4)) return true;
  return false;
}

function edges(polygon: Point[]): Segment[] {
  return polygon.map((point, index) => ({ a: point, b: polygon[(index + 1) % polygon.length] }));
}

/** true si les contours se touchent, se croisent ou se contiennent. */
export function polygonsIntersect(first: Point[], second: Point[]): boolean {
  if (first.some((point) => pointInPolygon(point, second))
    || second.some((point) => pointInPolygon(point, first))) {
    return true;
  }
  return edges(first).some((edgeA) => edges(second).some((edgeB) => segmentsIntersect(edgeA, edgeB)));
}

/** Distance minimale entre les contours (0 s'ils se touchent). */
export function polygonsDistance(first: Point[], second: Point[]): number {
  if (polygonsIntersect(first, second)) return 0;
  let best = Number.POSITIVE_INFINITY;
  for (const edgeA of edges(first)) {
    for (const edgeB of edges(second)) {
      best = Math.min(
        best,
        pointSegmentDistance(edgeA.a, edgeB),
        pointSegmentDistance(edgeA.b, edgeB),
        pointSegmentDistance(edgeB.a, edgeA),
        pointSegmentDistance(edgeB.b, edgeA),
      );
    }
  }
  return best;
}

/**
 * Conflit entre deux pièces : contact/croisement/contenu, ou écart
 * strictement inférieur à la marge entre pièces (gapCm). Un écart
 * exactement égal au gap est accepté ; avec gap 0, le simple contact
 * de bords reste un conflit (une lame ne peut pas couper deux pièces
 * collées).
 */
export function polygonsConflict(first: Point[], second: Point[], gapCm = 0): boolean {
  return polygonsIntersect(first, second) || polygonsDistance(first, second) < gapCm;
}

/**
 * Variante optimisée de `polygonsConflict` pour les boucles de nesting
 * (mêmes résultats, même unité) : zéro allocation intermédiaire,
 * rejet rapide des paires de segments dont les boîtes (inflatées du
 * gap) sont disjointes, et sorties anticipées dès qu'un conflit est
 * prouvé. Appelée des dizaines de milliers de fois par optimisation.
 * `firstOx`/`firstOy` : translation appliquée à `first` SANS créer de
 * contour intermédiaire (le candidat est testé là où il se poserait).
 */
export function polygonsConflictFast(
  first: Point[],
  second: Point[],
  gapCm: number,
  firstOx = 0,
  firstOy = 0,
): boolean {
  const n = first.length;
  const m = second.length;
  const hasOffset = firstOx !== 0 || firstOy !== 0;
  // 1) Contenance (sommet de l'un dans l'autre), avec rejet rapide
  // par enveloppe ; détecte sans coût les candidats intérieurs.
  let minX2 = Number.POSITIVE_INFINITY;
  let minY2 = Number.POSITIVE_INFINITY;
  let maxX2 = Number.NEGATIVE_INFINITY;
  let maxY2 = Number.NEGATIVE_INFINITY;
  for (let j = 0; j < m; j += 1) {
    const p = second[j];
    if (p.x < minX2) minX2 = p.x;
    if (p.x > maxX2) maxX2 = p.x;
    if (p.y < minY2) minY2 = p.y;
    if (p.y > maxY2) maxY2 = p.y;
  }
  for (let i = 0; i < n; i += 1) {
    const p = first[i];
    const px = hasOffset ? p.x + firstOx : p.x;
    const py = hasOffset ? p.y + firstOy : p.y;
    if (px < minX2 || px > maxX2 || py < minY2 || py > maxY2) continue;
    if (pointInPolygonOffset(p, second, firstOx, firstOy)) return true;
  }
  let minX1 = Number.POSITIVE_INFINITY;
  let minY1 = Number.POSITIVE_INFINITY;
  let maxX1 = Number.NEGATIVE_INFINITY;
  let maxY1 = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < n; i += 1) {
    const p = first[i];
    const px = hasOffset ? p.x + firstOx : p.x;
    const py = hasOffset ? p.y + firstOy : p.y;
    if (px < minX1) minX1 = px;
    if (px > maxX1) maxX1 = px;
    if (py < minY1) minY1 = py;
    if (py > maxY1) maxY1 = py;
  }
  for (let j = 0; j < m; j += 1) {
    const p = second[j];
    if (p.x < minX1 || p.x > maxX1 || p.y < minY1 || p.y > maxY1) continue;
    // p ∈ (first + offset) ⟺ (p − offset) ∈ first : l'offset appartient
    // au polygone `first`, pas au point testé (signe inversé).
    if (pointInPolygon(p, first, -firstOx, -firstOy)) return true;
  }
  // 2) Boucle unique sur les paires d'arêtes : distance minimale (au
  // carré, sans racine) puis croisement — rejet immédiat des paires
  // dont les boîtes élargies du gap sont disjointes (ni croisement ni
  // écart < gap possibles), sortie anticipée dès qu'un conflit est
  // prouvé.
  const gapSq = gapCm * gapCm;
  for (let j = 0; j < m; j += 1) {
    const b1 = second[j];
    const b2 = second[(j + 1) % m];
    const bMinX = Math.min(b1.x, b2.x);
    const bMaxX = Math.max(b1.x, b2.x);
    const bMinY = Math.min(b1.y, b2.y);
    const bMaxY = Math.max(b1.y, b2.y);
    const bdx = b2.x - b1.x;
    const bdy = b2.y - b1.y;
    const blenSq = bdx * bdx + bdy * bdy;
    for (let i = 0; i < n; i += 1) {
      const a1 = first[i];
      const a2 = first[(i + 1) % n];
      const a1x = hasOffset ? a1.x + firstOx : a1.x;
      const a1y = hasOffset ? a1.y + firstOy : a1.y;
      const a2x = hasOffset ? a2.x + firstOx : a2.x;
      const a2y = hasOffset ? a2.y + firstOy : a2.y;
      if (Math.min(a1x, a2x) - gapCm > bMaxX) continue;
      if (Math.max(a1x, a2x) + gapCm < bMinX) continue;
      if (Math.min(a1y, a2y) - gapCm > bMaxY) continue;
      if (Math.max(a1y, a2y) + gapCm < bMinY) continue;
      // Distance au carré des 4 sommets contre l'arête opposée.
      const adx = a2x - a1x;
      const ady = a2y - a1y;
      const alenSq = adx * adx + ady * ady;
      const dA1 = pointSegmentDistSq(a1x, a1y, b1.x, b1.y, bdx, bdy, blenSq);
      if (dA1 < gapSq) return true;
      const dA2 = pointSegmentDistSq(a2x, a2y, b1.x, b1.y, bdx, bdy, blenSq);
      if (dA2 < gapSq) return true;
      const dB1 = pointSegmentDistSq(b1.x, b1.y, a1x, a1y, adx, ady, alenSq);
      if (dB1 < gapSq) return true;
      const dB2 = pointSegmentDistSq(b2.x, b2.y, a1x, a1y, adx, ady, alenSq);
      if (dB2 < gapSq) return true;
      // Croisement : seulement si les boîtes (non élargies) se
      // recouvrent — sinon les segments ne peuvent pas se croiser.
      if (Math.min(a1x, a2x) > bMaxX || Math.max(a1x, a2x) < bMinX) continue;
      if (Math.min(a1y, a2y) > bMaxY || Math.max(a1y, a2y) < bMinY) continue;
      if (segmentsCross(a1x, a1y, a2x, a2y, b1.x, b1.y, b2.x, b2.y)) return true;
    }
  }
  return false;
}

/** Distance AU CARRÉ point → segment (coordonnées à plat, zéro alloc). */
function pointSegmentDistSq(
  px: number, py: number, ax: number, ay: number,
  dx: number, dy: number, lenSq: number,
): number {
  let t = 0;
  if (lenSq > 0) {
    t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
  }
  const ex = px - (ax + t * dx);
  const ey = py - (ay + t * dy);
  return ex * ex + ey * ey;
}

/** Test de croisement de deux segments par coordonnées à plat. */
function segmentsCross(
  ax1: number, ay1: number, ax2: number, ay2: number,
  bx1: number, by1: number, bx2: number, by2: number,
): boolean {
  const d1 = crossOrientation(bx1, by1, bx2, by2, ax1, ay1);
  const d2 = crossOrientation(bx1, by1, bx2, by2, ax2, ay2);
  const d3 = crossOrientation(ax1, ay1, ax2, ay2, bx1, by1);
  const d4 = crossOrientation(ax1, ay1, ax2, ay2, bx2, by2);
  // Branche stricte identique à `segmentsIntersect` (o1 !== o2) : un
  // zéro (point sur la droite porteuse) compte comme un côté distinct,
  // conformément au comportement validé de la référence.
  if (d1 !== d2 && d3 !== d4) return true;
  if (d1 === 0 && onSegmentCoords(bx1, by1, bx2, by2, ax1, ay1)) return true;
  if (d2 === 0 && onSegmentCoords(bx1, by1, bx2, by2, ax2, ay2)) return true;
  if (d3 === 0 && onSegmentCoords(ax1, ay1, ax2, ay2, bx1, by1)) return true;
  if (d4 === 0 && onSegmentCoords(ax1, ay1, ax2, ay2, bx2, by2)) return true;
  return false;
}

function crossOrientation(
  ax: number, ay: number, bx: number, by: number, cx: number, cy: number,
): number {
  // Formule et seuil identiques à `orientation` : les deux tests de
  // croisement (référence et rapide) doivent classer les contacts
  // quasi dégénérés de manière identique, sans quoi le chemin rapide
  // manque des conflits détectés par la référence.
  const value = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  if (Math.abs(value) <= EPSILON) return 0;
  return value > 0 ? 1 : 2;
}

function onSegmentCoords(
  ax: number, ay: number, bx: number, by: number, px: number, py: number,
): boolean {
  return px >= Math.min(ax, bx) - 1e-9 && px <= Math.max(ax, bx) + 1e-9
    && py >= Math.min(ay, by) - 1e-9 && py <= Math.max(ay, by) + 1e-9;
}

/** true si le contour tient entièrement dans la zone (tolérance incluse). */
export function insideRect(points: Point[], zone: Rect, toleranceCm = 1e-6): boolean {
  return points.every((point) =>
    point.x >= zone.x - toleranceCm
    && point.y >= zone.y - toleranceCm
    && point.x <= zone.x + zone.width + toleranceCm
    && point.y <= zone.y + zone.height + toleranceCm);
}

/**
 * Rotations permises pour une pièce : intersection entre les angles
 * déclarés par le patron et le sens du tissu (un tissu « sens unique »
 * n'autorise jamais le retournement à 180°).
 */
export function grainPermittedRotations(grainDirection: GrainDirection, allowedRotations: number[], oneWay = false): number[] {
  const byGrain = grainDirection === 'along' ? [0, 180]
    : grainDirection === 'cross' ? [90, 270]
      : [0, 90, 180, 270];
  return allowedRotations.filter((rotation) => byGrain.includes(rotation) && (!oneWay || rotation === 0));
}

/** Accroche `value` à la cible la plus proche située sous le seuil. */
export function snap(value: number, targets: number[], thresholdCm: number): number {
  let best = value;
  let distance = thresholdCm;
  for (const target of targets) {
    const gap = Math.abs(value - target);
    if (gap < distance) {
      distance = gap;
      best = target;
    }
  }
  return best;
}

/**
 * Position accrochée d'une pièce (coin supérieur gauche) : cibles
 * fournies par l'appelant (bords de zone, axes de grille, bords des
 * pièces voisines décalés du gap). Aucun accrochage n'est forcé
 * au-delà du seuil : le magnétisme ne déplace jamais hors contraintes.
 */
export function snapPosition(
  x: number,
  y: number,
  targetsX: number[],
  targetsY: number[],
  thresholdCm: number,
): { x: number; y: number } {
  return { x: snap(x, targetsX, thresholdCm), y: snap(y, targetsY, thresholdCm) };
}
