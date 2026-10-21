import { bounds, grainPermittedRotations, polygonsConflict, transformContour, zonePoints, type FabricZone, type Point } from './coupe-geometry';
import type { NestingPlacement } from '@/server/coupe/nesting';
import type { PatternPiece } from '@/server/coupe/patterns';

/**
 * Helpers purs d'édition interactive du plan de placement (étape 8).
 *
 * Partagés entre le canvas client (validation en temps réel pendant le
 * glisser-déposer) et les tests. Ils reproduisent exactement les règles
 * serveur de verifyLayout (limites, marge, défauts, chevauchements,
 * rotations autorisées) : le rendu visuel n'est jamais la source de
 * vérité, et le serveur reste l'autorité finale à chaque commit.
 * Toutes les coordonnées sont en centimètres réels, indépendantes du
 * zoom écran.
 */

export interface PlacementContext {
  widthCm: number;
  lengthCm: number;
  marginCm: number;
  gapCm: number;
  oneWay: boolean;
  scaleX: number;
  scaleY: number;
  defects: FabricZone[];
}

export function candidatePoints(pattern: PatternPiece, x: number, y: number, rotation: number, ctx: PlacementContext): Point[] {
  return transformContour(pattern.points, rotation, ctx.scaleX, ctx.scaleY).map((point) => ({ x: point.x + x, y: point.y + y }));
}

export function rotationChoices(pattern: PatternPiece, ctx: PlacementContext): number[] {
  return grainPermittedRotations(pattern.grainDirection, pattern.allowedRotations, ctx.oneWay);
}

/** Contrôles identiques à verifyLayout, pour une seule pièce déplacée. */
export function placementIssue(piece: NestingPlacement, others: NestingPlacement[], pattern: PatternPiece, rotation: number, ctx: PlacementContext): string | null {
  if (!rotationChoices(pattern, ctx).includes(rotation)) {
    return `rotation ${rotation}° non autorisée pour ${piece.pieceLabel} (droit-fil ${pattern.grainDirection}${ctx.oneWay ? ', tissu sens unique' : ''}).`;
  }
  const tolerance = 1e-7;
  if (piece.points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y) ||
    point.x < ctx.marginCm - tolerance || point.y < ctx.marginCm - tolerance ||
    point.x > ctx.widthCm - ctx.marginCm + tolerance || point.y > ctx.lengthCm - ctx.marginCm + tolerance)) {
    return `pièce hors du tissu ou de la marge de sécurité : ${piece.pieceLabel}.`;
  }
  if (ctx.defects.map(zonePoints).some((zone) => polygonsConflict(piece.points, zone, ctx.gapCm))) {
    return `pièce sur une zone interdite du tissu : ${piece.pieceLabel}.`;
  }
  if (others.some((other) => polygonsConflict(piece.points, other.points, ctx.gapCm))) {
    return `chevauchement ou espacement insuffisant avec une autre pièce : ${piece.pieceLabel}.`;
  }
  return null;
}

/** Accrochage aux bords exploitables, aux axes et aux pièces voisines. */
export function snapPosition(x: number, y: number, boxWidth: number, boxHeight: number, others: NestingPlacement[], ctx: PlacementContext): { x: number; y: number } {
  const threshold = Math.max(1.2, ctx.gapCm * 2);
  const targetsX = [ctx.marginCm, ctx.widthCm - ctx.marginCm - boxWidth];
  const targetsY = [ctx.marginCm, ctx.lengthCm - ctx.marginCm - boxHeight];
  for (const other of others) {
    const box = bounds(other.points);
    targetsX.push(box.minX - ctx.gapCm - boxWidth, box.maxX + ctx.gapCm);
    targetsY.push(box.minY - ctx.gapCm - boxHeight, box.maxY + ctx.gapCm);
  }
  const snap = (value: number, targets: number[]) => {
    let best = value;
    let distance = threshold;
    for (const target of targets) {
      const gapTo = Math.abs(value - target);
      if (gapTo < distance) { distance = gapTo; best = target; }
    }
    return best;
  };
  return { x: snap(x, targetsX), y: snap(y, targetsY) };
}

/** Empreinte stable d'un placement : distingue l'automatique du manuel. */
export function layoutSignature(placements: NestingPlacement[]): string {
  return placements.map((piece) => `${piece.patternId}:${piece.x.toFixed(2)}:${piece.y.toFixed(2)}:${piece.rotation}`).join('|');
}
