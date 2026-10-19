'use client';

import { useCallback } from 'react';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { MarkerPlanRow } from '@/server/coupe/marker';
import type {
  LotWorkflowRow,
  LotCheckResult,
  LotAnomalyDTO,
} from '@/server/coupe/lot-workflow';
import { useCoupeData } from '../use-coupe';
import LotWorkflowInfo from './lot-workflow-info';
import LotPlanPanel from './lot-plan-panel';
import LotWorkflowActions from './lot-workflow-actions';
import { StatusChip, formatDateTime } from './workflow-common';

/**
 * Écran central du lot : toutes les informations sont affichées
 * automatiquement (commande, tailles, matelas, plan, vérifications,
 * anomalies, historique) et les actions se limitent aux étapes qui
 * exigent une décision humaine.
 */

interface DetailBody {
  lot: LotWorkflowRow;
  readiness: LotCheckResult;
  plan: MarkerPlanRow | null;
  anomalies: LotAnomalyDTO[];
  history: Array<{
    id: number;
    action: string;
    reason: string | null;
    actorNom: string | null;
    createdAt: string;
  }>;
}

const ACTION_LABELS: Record<string, string> = {
  lot_created_from_order: 'Lot créé depuis la commande',
  lot_plan_generated: 'Plan de placement généré',
  lot_plan_validated: 'Plan validé',
  lot_cutting_started: 'Coupe démarrée',
  lot_actual_recorded: 'Résultats réels enregistrés',
  lot_results_confirmed: 'Résultats confirmés',
  lot_transfer_prepared: 'Transfert préparé',
  lot_transfer_confirmed: 'Transfert confirmé',
  lot_cancelled: 'Lot annulé',
};

export default function LotWorkflowDetail({ lotId }: { lotId: number }) {
  const { data, loading, error, refresh } = useCoupeData<DetailBody>(
    `/api/coupe/lots/${lotId}/workflow`,
  );

  const reload = useCallback(() => {
    void refresh();
  }, [refresh]);

  if (loading && !data) {
    return <CircularProgress size={28} />;
  }
  if (error) {
    return <Alert severity="error">{error}</Alert>;
  }
  if (!data) {
    return <Alert severity="info">Lot introuvable.</Alert>;
  }

  const { lot, readiness, plan, anomalies, history } = data;

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={2} alignItems="center">
        <Typography variant="h6">
          Lot {lot.code} — {lot.productNom}
          {lot.colorNom ? ` (${lot.colorNom})` : ''}
        </Typography>
        <StatusChip status={lot.status} />
      </Stack>

      <LotWorkflowActions lot={lot} planId={plan?.id ?? null} onRefresh={reload} />

      <LotWorkflowInfo
        lot={lot}
        readiness={readiness}
        anomalies={anomalies}
      />

      {plan ? (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <LotPlanPanel plan={plan} />
        </Paper>
      ) : (
        <Alert severity="info">
          Aucun plan de placement — préparez le matelas pour en générer un.
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle2" gutterBottom>
          Historique des opérations
        </Typography>
        {history.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Aucune opération enregistrée.
          </Typography>
        ) : (
          <Grid container spacing={1}>
            {history.map((entry) => (
              <Grid size={{ xs: 12 }} key={entry.id}>
                <Typography variant="body2">
                  {formatDateTime(entry.createdAt)} —{' '}
                  {ACTION_LABELS[entry.action] ?? entry.action}
                  {entry.actorNom ? ` — ${entry.actorNom}` : ''}
                  {entry.reason ? ` (${entry.reason})` : ''}
                </Typography>
              </Grid>
            ))}
          </Grid>
        )}
        <Divider sx={{ mt: 1 }} />
        <Typography variant="caption" color="text.secondary">
          Les versions précédentes des plans validés sont conservées dans
          l&apos;historique du système.
        </Typography>
      </Paper>
    </Stack>
  );
}
