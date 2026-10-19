'use client';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import LinearProgress from '@mui/material/LinearProgress';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { MgDashboardDTO } from '@/types/magasinier';
import { useMagasinierData } from './use-magasinier';

/** Tableau de bord du chef magasinier : uniquement des données réelles. */

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <Paper variant="outlined" className="p-3">
      <Typography variant="h5">{value}</Typography>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
    </Paper>
  );
}

export default function MagasinierDashboardView({ name }: { name: string }) {
  const { data, loading, error } = useMagasinierData<MgDashboardDTO>(
    '/api/magasinier/dashboard',
  );

  return (
    <Stack spacing={3}>
      <Typography variant="h5">Bienvenue, {name}</Typography>
      <Typography variant="body2" color="text.secondary">
        Import des commandes PDF, préparation sur stock réel et dossiers de
        sortie pour le contrôle sécurité.
      </Typography>
      {loading ? <LinearProgress /> : null}
      {error ? <Alert severity="error">{error}</Alert> : null}
      {data ? (
        <>
          <Box className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Documents importés" value={data.documentsImported} />
            <Metric label="Documents à vérifier" value={data.documentsToVerify} />
            <Metric label="Documents en erreur / rejetés" value={data.documentsErrored} />
            <Metric label="Commandes validées" value={data.ordersValidated} />
            <Metric label="Préparations en cours" value={data.ordersInPreparation} />
            <Metric label="Préparations partielles" value={data.ordersPartial} />
            <Metric label="Préparations complètes" value={data.ordersComplete} />
            <Metric label="Dossiers soumis à sécurité" value={data.dossiersSubmitted} />
            <Metric label="Dossiers retournés" value={data.dossiersReturned} />
            <Metric label="Commandes bloquées" value={data.ordersBlocked} />
            <Metric
              label="Quantités commandées / préparées"
              value={`${data.totalOrderedQty} / ${data.totalPreparedQty}`}
            />
            <Metric label="Anomalies en attente (alertes)" value={data.openAlerts} />
          </Box>

          <Typography variant="subtitle1">Dernières opérations</Typography>
          {data.recentHistory.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              Aucune opération enregistrée.
            </Typography>
          ) : (
            <Paper variant="outlined" className="p-3">
              <Stack spacing={0.5}>
                {data.recentHistory.map((entry) => (
                  <Typography key={entry.id} variant="caption" color="text.secondary">
                    {entry.createdAt} — {entry.action} — {entry.actorNom ?? 'système'}
                    {entry.reason ? ` — ${entry.reason}` : ''}
                  </Typography>
                ))}
              </Stack>
            </Paper>
          )}
        </>
      ) : null}
    </Stack>
  );
}

export function MgAlertsList({
  alerts,
}: {
  alerts: Array<{ id: number; category: string; severity: string; message: string; status: string; createdAt: string }>;
}) {
  if (alerts.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        Aucune alerte.
      </Typography>
    );
  }
  return (
    <Stack spacing={1}>
      {alerts.map((alert) => (
        <Alert key={alert.id} severity={alert.severity === 'critical' ? 'error' : 'warning'}>
          <Typography variant="body2">
            [{alert.category}] {alert.message} — statut :{' '}
            <Chip size="small" label={alert.status} /> — {alert.createdAt}
          </Typography>
        </Alert>
      ))}
    </Stack>
  );
}
