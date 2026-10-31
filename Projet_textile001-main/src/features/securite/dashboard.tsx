'use client';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import LinearProgress from '@mui/material/LinearProgress';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { SecDashboardDTO } from '@/types/securite';
import {
  KpiCard,
  SectionTitle,
  WelcomeBanner,
  kpiTone,
} from '@/components/common/dashboard-kit';
import { useSecuriteData } from './use-securite';

/** Tableau de bord du chef sécurité : uniquement des données réelles. */

function Metric({ label, value }: { label: string; value: number | string }) {
  return <KpiCard label={label} value={value} tone={kpiTone(label.length)} />;
}

export default function SecuriteDashboardView({ name }: { name: string }) {
  const { data, loading, error } = useSecuriteData<SecDashboardDTO>(
    '/api/securite/dashboard',
  );

  return (
    <Stack spacing={3}>
      <WelcomeBanner
        name={name}
        roleLabel="Chef sécurité"
        moduleLabel="Module Sécurité"
        description="Contrôle indépendant des dossiers de sortie : comptage physique, anomalies, décision et confirmation de sortie. Le stock n'est jamais modifié directement par la sécurité."
      />
      {loading ? <LinearProgress /> : null}
      {error ? <Alert severity="error">{error}</Alert> : null}
      {data ? (
        <>
          <Box className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Dossiers en attente de contrôle" value={data.dossiersPending} />
            <Metric label="Contrôles en cours" value={data.controlsRunning} />
            <Metric label="Contrôles conformes" value={data.controlsConforme} />
            <Metric label="Dossiers bloqués" value={data.dossiersBlocked} />
            <Metric label="Cartons attendus (dossiers soumis)" value={data.cartonsExpected} />
            <Metric label="Cartons comptés (contrôles en cours)" value={data.cartonsObserved} />
            <Metric label="Anomalies ouvertes" value={data.anomaliesOpen} />
            <Metric label="Contre-vérifications en attente" value={data.counterChecksPending} />
            <Metric label="Sorties autorisées" value={data.sortiesAuthorized} />
            <Metric label="Sorties physiquement confirmées" value={data.sortiesConfirmed} />
            <Metric label="Sorties refusées" value={data.sortiesRefused} />
          </Box>

          <SectionTitle>Dernières opérations</SectionTitle>
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

export function SecAlertsList({
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
