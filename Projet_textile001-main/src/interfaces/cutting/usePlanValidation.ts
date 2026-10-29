'use client';

import { useCallback, useState } from 'react';
import { atelierAction, loadWorkspace } from './api';
import type { PlanDTO, WorkspaceData } from './api';

interface Props {
  plan: PlanDTO | null;
  canValidate: boolean;
  dirty: boolean;
  refreshPlan: (plan: PlanDTO) => void;
  setWorkspace: (workspace: WorkspaceData) => void;
  setToast: (toast: { message: string; severity: 'success' | 'error' | 'warning' }) => void;
}

export function usePlanValidation(props: Props) {
  const { plan, canValidate, dirty, refreshPlan, setWorkspace, setToast } = props;
  const [validating, setValidating] = useState(false);

  const validatePlan = useCallback(async () => {
    if (!canValidate || !plan || plan.status !== 'proposition') return;
    if (dirty) {
      setToast({ message: 'Enregistrez le placement avant de valider le plan.', severity: 'warning' });
      return;
    }
    if (!window.confirm('Valider ce plan ? Il deviendra immuable et pourra être transféré après la coupe réelle.')) return;
    setValidating(true);
    try {
      const validated = await atelierAction<PlanDTO>('plan.validate', { planId: plan.id });
      refreshPlan(validated);
      setWorkspace(await loadWorkspace());
      // Résultat du calcul automatique de consommation (côté serveur).
      if (validated.theoretical) {
        const t = validated.theoretical;
        const label = t.formula === 'C12'
          ? 'formule ORDNUR (tshirt)'
          : `formule « panneaux » (${t.family})`;
        const parDouzaine = t.formula === 'C12'
          ? ` — ${(t.netKgPerPiece * 12).toFixed(3)} kg/douzaine`
          : '';
        setToast({
          message: `Plan #${validated.id} validé. Consommation théorique estimée (${label}, `
            + `GSM ${t.grammageGm2}, wastage ${t.wastagePct} %) : `
            + `${t.netKgPerPiece.toFixed(4)} kg/pièce${parDouzaine}, `
            + `total ${t.kgWithWastage.toFixed(3)} kg. `
            + 'Estimation théorique, pas une mesure réelle.',
          severity: 'success',
        });
      } else {
        setToast({
          message: `Plan #${validated.id} validé. Estimation théorique indisponible : `
            + `${validated.theoreticalUnavailable ?? 'cause inconnue'}`,
          severity: 'warning',
        });
      }
    } catch (error) {
      setToast({ message: (error as Error).message, severity: 'error' });
    } finally {
      setValidating(false);
    }
  }, [canValidate, dirty, plan, refreshPlan, setToast, setWorkspace]);

  return { validating, validatePlan };
}
