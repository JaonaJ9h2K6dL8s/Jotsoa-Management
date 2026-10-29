'use client';

import { useMemo } from 'react';
import { summarizePlacement } from '@/lib/cutting/metrics';
import type { RevisionDTO, WorkspaceData } from './api';
import type { UIPiece } from './canvas/frame';

/**
 * Quantités attendues / placées / valides / manquantes (étapes 7-8) :
 * recalculées à chaque geste à partir du placement courant et de la
 * validation temps réel — aucune saisie manuelle.
 */
export function usePlacementSummary(
  workspace: WorkspaceData | null,
  revision: RevisionDTO | null,
  placements: UIPiece[],
  displayedViolations: Map<string, string>,
  viewMode: 'current' | 'proposal',
): {
  summary: ReturnType<typeof summarizePlacement> | null;
  sizeLabel: string;
  placedCounts: Map<number, number>;
} {
  const placedCounts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const item of placements) {
      counts.set(item.pieceId, (counts.get(item.pieceId) ?? 0) + 1);
    }
    return counts;
  }, [placements]);

  // Occurrences invalides par pièce (mode courant uniquement : une
  // proposition affiche ses propres indicateurs).
  const invalidCounts = useMemo(() => {
    const counts = new Map<number, number>();
    if (viewMode !== 'current') return counts;
    for (const item of placements) {
      if (displayedViolations.has(item.key)) {
        counts.set(item.pieceId, (counts.get(item.pieceId) ?? 0) + 1);
      }
    }
    return counts;
  }, [viewMode, placements, displayedViolations]);

  const summary = useMemo(() => {
    if (!revision) return null;
    return summarizePlacement(
      revision.pieces.map((piece) => ({
        pieceId: piece.id, code: piece.code, label: piece.label,
        component: piece.component, qty: piece.qty, status: piece.status,
      })),
      placedCounts,
      invalidCounts,
    );
  }, [revision, placedCounts, invalidCounts]);

  const sizeLabel = useMemo(() => {
    if (!revision || !workspace) return '—';
    const catalogue = workspace.catalogue.find((item) => item.productId === revision.productId);
    return catalogue?.sizes.find((size) => size.id === revision.sizeId)?.nom ?? `#${revision.sizeId}`;
  }, [revision, workspace]);

  return { summary, sizeLabel, placedCounts };
}
