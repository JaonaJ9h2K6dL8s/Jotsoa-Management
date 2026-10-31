'use client';

import { useCallback, useMemo, useState } from 'react';
import type { RefObject } from 'react';
import { atelierAction } from './api';
import type {
  AutofillResult, OptimizeMetrics, OptimizeResult, PlanDTO, RevisionDTO, RollDTO, VerifyResult,
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
  /** Recharge le plan courant depuis le serveur (après recalcul multi-matelas). */
  reloadPlan?: (planId: number) => Promise<void>;
  /** Recharge la liste des plans (nouveaux matelas dupliqués visibles). */
  reloadPlans?: () => Promise<void>;
}

export function usePlanOptimizer(options: UsePlanOptimizerOptions) {
  const {
    plan, revision, roll, history, canvasRef, setToast, reloadPlan, reloadPlans,
  } = options;
  const [optimizing, setOptimizing] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [optimize, setOptimize] = useState<OptimizeResult | null>(null);
  const [proposalPlacements, setProposalPlacements] = useState<UIPiece[]>([]);
  const [viewMode, setViewMode] = useState<'current' | 'proposal'>('current');
  /** Dernier résultat du calcul automatique multi-matelas (résumé persistant). */
  const [autofill, setAutofill] = useState<AutofillResult | null>(null);
  const [applyingTarget, setApplyingTarget] = useState(false);

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

  /** Affiche la proposition d'un calcul multi-matelas sur le canvas. */
  const presentAutofill = useCallback((result: AutofillResult) => {
    setProposalPlacements(
      result.placements.map((placement, index) => placementToUi(placement, index)),
    );
    setOptimize({
      planId: plan?.id ?? 0,
      revisionId: 0,
      method: result.method,
      placements: result.placements,
      unplaced: [],
      metrics: result.metrics,
      wasteKg: null,
      grammageGm2: null,
      availableLengthCm: plan?.matelas_length_cm ?? 0,
    });
    setViewMode('proposal');
    requestAnimationFrame(() => canvasRef.current?.fit());
  }, [plan, canvasRef]);

  /**
   * Calcul automatique multi-matelas : remplit le matelas de jeux
   * complets du patron, borne le nombre de matelas par le stock du
   * rouleau (métrage, grammage, couches), puis duplique les matelas.
   * Le résultat complet est conservé (résumé de production persistant).
   */
  const runAutofill = useCallback(async () => {
    if (!plan) return;
    setOptimizing(true);
    try {
      const result = await atelierAction<AutofillResult>('plan.autofill', {
        planId: plan.id,
      });
      setAutofill(result);
      presentAutofill(result);
      const rollInfo = result.rollAvailableM !== null
        ? ` Rouleau : ${result.rollAvailableM.toFixed(1)} m disponibles → `
          + `${result.totalMatelas} matelas plein(s) de `
          + `${result.fabricPerMatelasM.toFixed(1)} m chacun, reste `
          + `${result.rollRemainingAfterM?.toFixed(1)} m après coupe.`
        : '';
      const dupInfo = result.duplicates.length > 0
        ? ` ${result.duplicates.length} matelas dupliqué(s) automatiquement `
          + `(${result.duplicates.map((dup) => `#${dup.planId}`).join(', ')}).`
        : '';
      setToast({
        message: `Calcul automatique — patron ${result.piecesPerSet} pièces : `
          + `matelas plein = ${result.capacitySets} jeux × ${result.layers} couche(s) `
          + `= ${result.garmentsPerMatelas} vêtements / ${result.piecesPerMatelas} pièces.`
          + rollInfo
          + ` Total : ${result.totalGarments} vêtements, `
          + `${result.totalPieces} pièces obtenues.`
          + dupInfo,
        severity: 'success',
      });
    } catch (error) {
      setToast({ message: (error as Error).message, severity: 'error' });
    } finally {
      setOptimizing(false);
    }
  }, [plan, setToast, presentAutofill]);

  /**
   * Applique un nombre de matelas (tables) voulu par l'utilisateur :
   * le serveur complète ou supprime les duplicatas, puis le résumé et
   * les listes sont rafraîchis.
   */
  const applyTargetMatelas = useCallback(async (target: number) => {
    if (!plan || !Number.isFinite(target) || target < 1) return;
    setApplyingTarget(true);
    try {
      const result = await atelierAction<AutofillResult>('plan.autofill', {
        planId: plan.id, targetMatelas: Math.floor(target),
      });
      // Recharge AVANT d'afficher la proposition : refreshPlan remet
      // le mode « current », la proposition est réappliquée ensuite.
      await reloadPlan?.(plan.id);
      await reloadPlans?.();
      setAutofill(result);
      presentAutofill(result);
      setToast({
        message: `Production recalculée : ${result.totalMatelas} matelas, `
          + `${result.totalGarments} vêtements, ${result.totalPieces} pièces `
          + `(${result.duplicates.length} matelas dupliqué(s)).`,
        severity: 'success',
      });
    } catch (error) {
      setToast({ message: (error as Error).message, severity: 'error' });
    } finally {
      setApplyingTarget(false);
    }
  }, [plan, setToast, reloadPlan, reloadPlans, presentAutofill]);

  /** Réinitialise la proposition (chargement d'un autre plan, etc.). */
  const resetProposal = useCallback(() => {
    setOptimize(null);
    setProposalPlacements([]);
    setViewMode('current');
    setAutofill(null);
  }, []);

  return {
    optimizing, accepting, optimize, proposalPlacements, viewMode,
    currentMetrics, currentWasteKg, autofill, applyingTarget,
    runOptimize, runAutofill, applyTargetMatelas, acceptProposal, rejectProposal, resetProposal,
  };
}
