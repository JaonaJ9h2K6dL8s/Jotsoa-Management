import { snapPosition } from '@/lib/cutting/geometry';
import type { Rect } from '@/lib/cutting/types';
import type { UIPiece } from './frame';

/**
 * Magnétisme configurable (repère écran) : cibles = bords de la zone
 * utilisable, axes de grille (tous les 10 cm), bords des pièces
 * voisines décalés de l'écart entre pièces. Aucun accrochage forcé
 * au-delà du seuil : le magnétisme ne déplace jamais hors contraintes.
 */
export const SNAP_THRESHOLD_CM = 1.2;
export const GRID_STEP_CM = 10;

function gridTargets(zone: Rect, axis: 'x' | 'y'): number[] {
  const size = axis === 'x' ? zone.width : zone.height;
  const targets: number[] = [0, size];
  for (let value = GRID_STEP_CM; value < size; value += GRID_STEP_CM) {
    targets.push(value);
  }
  return targets;
}

export interface SnapContext {
  zone: Rect;
  gapCm: number;
  others: UIPiece[];
  extent: (placement: UIPiece) => { width: number; height: number };
}

/** Position accrochée d'une pièce déplacée (coin supérieur gauche). */
export function snapPlacement(
  placement: UIPiece,
  context: SnapContext,
): { x: number; y: number } {
  const { width, height } = context.extent(placement);
  const targetsX = [...gridTargets(context.zone, 'x')];
  const targetsY = [...gridTargets(context.zone, 'y')];
  for (const other of context.others) {
    if (other.key === placement.key) continue;
    const size = context.extent(other);
    targetsX.push(other.x, other.x + size.width, other.x - width - context.gapCm);
    targetsY.push(other.y, other.y + size.height, other.y - height - context.gapCm);
  }
  return snapPosition(
    placement.x,
    placement.y,
    targetsX,
    targetsY,
    SNAP_THRESHOLD_CM,
  );
}
