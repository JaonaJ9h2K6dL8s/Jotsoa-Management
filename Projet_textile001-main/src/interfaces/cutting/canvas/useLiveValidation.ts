'use client';

import { useMemo } from 'react';
import type { PieceDTO } from '../api';
import {
  insideRect,
  polygonsConflict,
} from '@/lib/cutting/geometry';
import type { Point, Rect } from '@/lib/cutting/types';
import { uiContour, type UIPiece } from './frame';

/**
 * Validation temps réel côté client : miroir EXACT des contrôles
 * serveur (plan.verify), exécuté dans le repère écran transposé.
 * Le contour rouge n'est jamais la seule vérité : le serveur
 * revalide tout à la sauvegarde.
 */
export function useLiveValidation(
  placements: UIPiece[],
  pieces: PieceDTO[],
  zone: Rect,
  gapCm: number,
): Map<string, string> {
  return useMemo(() => {
    const violations = new Map<string, string>();
    const byId = new Map(pieces.map((piece) => [piece.id, piece]));
    const contours: Array<Point[] | null> = placements.map((placement) => {
      const piece = byId.get(placement.pieceId);
      if (!piece) {
        violations.set(placement.key, 'Pièce inconnue pour ce plan.');
        return null;
      }
      if (!piece.allowedRotations.includes(
        placement.rotation === 90 ? 270 : placement.rotation === 270 ? 90 : placement.rotation,
      )) {
        violations.set(
          placement.key,
          `Rotation ${placement.rotation}° interdite pour ${piece.label} (droit-fil).`,
        );
        return null;
      }
      const contour = uiContour(piece.points, placement.rotation, placement.x, placement.y);
      if (!insideRect(contour, zone)) {
        violations.set(
          placement.key,
          `${piece.label} dépasse la zone utilisable du tissu.`,
        );
      }
      return contour;
    });
    for (let i = 0; i < placements.length; i += 1) {
      for (let j = i + 1; j < placements.length; j += 1) {
        const first = contours[i];
        const second = contours[j];
        if (!first || !second || first.length < 3 || second.length < 3) continue;
        if (polygonsConflict(first, second, gapCm)) {
          violations.set(
            placements[j].key,
            'Chevauchement (ou écart insuffisant) avec une autre pièce.',
          );
        }
      }
    }
    return violations;
  }, [placements, pieces, zone, gapCm]);
}
