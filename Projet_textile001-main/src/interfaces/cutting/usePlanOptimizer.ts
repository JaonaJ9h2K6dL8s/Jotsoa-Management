'use client';

import { useCallback, useMemo, useState } from 'react';
import type { RefObject } from 'react';
import { atelierAction } from './api';
import type {
  OptimizeMetrics, OptimizeResult, PlanDTO, RevisionDTO, RollDTO, VerifyResult,
} from './api';
import { computeMetrics, wasteKg } from '@/lib/cutting/optimizer';
import { transformContour } from '@/lib/cutting/geometry';
import type { Point, Rotation } from '@/lib/cutting/types';
import type { CanvasHandle } from './canvas/CuttingCanvas';
import { placementToServer, placementToUi, type UIPiece } from './canvas/frame';
import type { usePlanHistory } from './canvas/usePlanHistory';

/**
 * Logique d'optimisation du plan (étape 4) : appel serveur
 * plan.optimize (sans écriture), affichage de la proposition,
 * comparaison des indicateurs, acceptation avec recontrôle
 * plan.verify, rejet. L'enregistrement reste explicite dans
 * Workspace ; le placement manuel n'est jamais écrasé avant
 * confirmation.
 */

interface ToastState { message: string; severity: 'success' | 'error' | 'info' | 'warning' }

interface UsePlanOptimizerOptions {
  plan: PlanDTO | null;
  revision: RevisionDTO | null;
  roll: RollDTO | null;
  history: ReturnType<typeof usePlanHistory<UIPiece[]>>;
  canvasRef: RefObject<CanvasHandle | null>;
  setToast: (toast: ToastState) => void;
}

export function usePlanOptimizer(options: UsePlanOptimizerOptions) {
  const { plan, revision, roll, history, canvasRef, setToast } = options;
  const [optimizing, setOptimizing] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [optimize, setOptimize] = useState<OptimizeResult | null>(null);
  const [proposalPlacements, setProposalPlacements] = useState<UIPiece[]>([]);
  const [viewMode, setViewMode] = useState<'current' | 'proposal'>('current');

  // Indicateurs du plan courant (mêmes formules que la proposition,
  // calculées par la bibliothèque partagée côté client).
  const currentMetrics: OptimizeMetrics | null = useMemo(() => {
    if (!revision || !plan || history.state.length === 0) return null;
    const defs = new Map(revision.pieces.map((piece) => [piece.id, piece]));
    const contours: Point[][] = [];
    for (const item of history.state) {
      const piece = defs.get(item.pieceId);
      if (!piece) continue;
      contours.push(transformContour(
        piece.points, item.rotation as Rotation,
        item.y, item.x,
      ));
    }
    return computeMetrics(contours, plan.usable_width_cm, contours.length, 0);
  }, [revision, plan, history.state]);

  const currentWasteKg = currentMetrics
    ? wasteKg(currentMetrics.wasteAreaM2, roll?.grammageGm2 ?? null)
    : null;

  const runOptimize = useCallback(async () => {
    if (!plan) return;
    setOptimizing(true);
    try {
      const result = await atelierAction<OptimizeResult>('plan.optimize', { planId: plan.id });
      setProposalPlacements(
        result.placements.map((placement, index) => placementToUi(placement, index)),
      );
      setOptimize(result);
      setViewMode('proposal');
      requestAnimationFrame(() => canvasRef.current?.fit());
      setToast({
        message: result.metrics.unplacedCount === 0
          ? `Proposition prête : ${result.metrics.placedCount} pièces, `
            + `${result.metrics.utilizationPct.toFixed(1)} % d'utilisation.`
          : `Proposition incomplète : ${result.metrics.unplacedCount} pièce(s) non placée(s).`,
        severity: result.metrics.unplacedCount === 0 ? 'success' : 'warning',
      });
    } catch (error) {
      setToast({ message: (error as Error).message, severity: 'error' });
    } finally {
      setOptimizing(false);
    }
  }, [plan, canvasRef, setToast]);

  const acceptProposal = useCallback(async () => {
    if (!optimize || !plan) return;
    setAccepting(true);
    try {
      const serverPlacements = proposalPlacements.map((item) => placementToServer(item));
      const verify = await atelierAction<VerifyResult>('plan.verify', {
        planId: plan.id, placements: serverPlacements,
      });
      if (!verify.ok) {
        setToast({
          message: `Proposition refusée par le serveur `
            + `(${verify.violations.length} problème(s)).`,
          severity: 'error',
        });
        return;
      }
      history.commit(history.state, proposalPlacements);
      setOptimize(null);
      setProposalPlacements([]);
      setViewMode('current');
      setToast({
        message: 'Proposition acceptée et vérifiée par le serveur. '
          + 'Enregistrez pour la conserver.',
        severity: 'success',
      });
    } catch (error) {
      setToast({ message: (error as Error).message, severity: 'error' });
    } finally {
      setAccepting(false);
    }
  }, [optimize, plan, proposalPlacements, history, setToast]);

  const rejectProposal = useCallback(() => {
    setOptimize(null);
    setProposalPlacements([]);
    setViewMode('current');
  }, []);

  /** Réinitialise la proposition (chargement d'un autre plan, etc.). */
  const resetProposal = useCallback(() => {
    setOptimize(null);
    setProposalPlacements([]);
    setViewMode('current');
  }, []);

  return {
    optimizing, accepting, optimize, proposalPlacements, viewMode,
    currentMetrics, currentWasteKg,
    runOptimize, acceptProposal, rejectProposal, resetProposal,
  };
}
