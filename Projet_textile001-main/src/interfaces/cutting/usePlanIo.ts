'use client';

import { useCallback } from 'react';
import { atelierAction } from './api';
import type { CutTransferResult, PlanDTO, RemetricsResult } from './api';

/**
 * Actions serveur du plan ouvert (transfert réel vers la Couture et
 * recalcul explicite des métriques d'un brouillon), avec rechargement
 * systématique du plan depuis l'autorité serveur.
 */
export function usePlanIo(
  refreshPlan: (next: PlanDTO) => void,
  setToast: (toast: { message: string; severity: 'success' | 'error' | 'info' | 'warning' }) => void,
): {
  handleTransfer: (input: {
    planId: number;
    cutPieces: Array<{ pieceId: number; qty: number }>;
    confirmCut: true;
  }) => Promise<CutTransferResult>;
  handleRemetrics: (planId: number) => Promise<RemetricsResult>;
} {
  const handleTransfer = useCallback(async (input: {
    planId: number;
    cutPieces: Array<{ pieceId: number; qty: number }>;
    confirmCut: true;
  }): Promise<CutTransferResult> => {
    const transfer = await atelierAction<CutTransferResult>('transfer.create', input);
    const reloaded = await atelierAction<PlanDTO>('plan.get', { planId: input.planId });
    refreshPlan(reloaded);
    setToast({
      message: `Transfert confirmé : ${transfer.transferredQty} pièce(s) vers la Couture (${transfer.transferCode}).`,
      severity: 'success',
    });
    return transfer;
  }, [refreshPlan, setToast]);

  const handleRemetrics = useCallback(async (planId: number): Promise<RemetricsResult> => {
    const result = await atelierAction<RemetricsResult>('plan.remetrics', { planId });
    const reloaded = await atelierAction<PlanDTO>('plan.get', { planId });
    refreshPlan(reloaded);
    setToast({
      message: `Métriques recalculées : ${result.before.markerLengthCm.toFixed(1)} cm → ${result.after.markerLengthCm.toFixed(1)} cm.`,
      severity: 'success',
    });
    return result;
  }, [refreshPlan, setToast]);

  return { handleTransfer, handleRemetrics };
}
