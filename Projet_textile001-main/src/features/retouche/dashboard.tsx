import Alert from '@mui/material/Alert';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { RtDashboardDTO } from '@/types/retouche';
import { formatWorkDuration } from '@/components/common/work-timer';
import {
  KpiCard,
  SectionTitle,
  WelcomeBanner,
  kpiTone,
} from '@/components/common/dashboard-kit';

/**
 * Tableau de bord du retoucheur : compteurs calculés depuis les
 * données réelles de SQLite (demandes, interventions, quantités).
 */

function CounterCard({ label, value }: { label: string; value: number }) {
  return (
    <Grid size={{ xs: 6, sm: 4, md: 3 }}>
      <KpiCard label={label} value={value} tone={kpiTone(label.length)} />
    </Grid>
  );
}

function formatTimestamp(value: string): string {
  const date = new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z');
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

export default function RetoucheDashboard({
  name,
  data,
}: {
  name: string;
  data: RtDashboardDTO;
}) {
  const q = data.quantities;
  return (
    <Stack spacing={3}>
      <WelcomeBanner
        name={name}
        roleLabel="Retoucheur"
        moduleLabel="Module Retouche"
        description="Réception des demandes du Contrôle qualité, interventions de retouche et transmission au contrôle final."
      />

      {data.pendingRebutProposals > 0 ? (
        <Alert severity="warning">
          {data.pendingRebutProposals} proposition(s) de rebut en attente de
          décision du Contrôle qualité.
        </Alert>
      ) : null}
      {data.openAlerts > 0 ? (
        <Alert severity="info">
          {data.openAlerts} alerte(s) ouverte(s) —{' '}
          <a href="/retouche/alertes">voir les alertes</a>.
        </Alert>
      ) : null}

      <SectionTitle>Demandes et tâches</SectionTitle>
      <Grid container spacing={2}>
        <CounterCard label="Demandes reçues du CQ" value={data.requestsCount} />
        <CounterCard label="En attente de réception" value={data.pendingReception} />
        <CounterCard label="En attente d’affectation" value={data.pendingAssignment} />
        <CounterCard label="Affectations en cours" value={data.assignmentsInProgress} />
        <CounterCard label="Interventions en cours" value={data.interventionsInProgress} />
      </Grid>

      <SectionTitle>Heures travaillées (temps réel, pauses exclues)</SectionTitle>
      {(data.workedByRetoucheur?.length ?? 0) === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Aucune heure de travail enregistrée.
        </Typography>
      ) : (
        <Grid container spacing={2}>
          {data.workedByRetoucheur.map((entry) => (
            <Grid size={{ xs: 12, sm: 6, md: 4 }} key={entry.retoucheurNom}>
              <Paper variant="outlined" className="p-3">
                <Typography variant="body2">{entry.retoucheurNom}</Typography>
                <Typography
                  variant="h6"
                  sx={{ fontVariantNumeric: 'tabular-nums' }}
                  color={entry.activeTasks > 0 ? 'success.main' : 'text.primary'}
                >
                  {formatWorkDuration(entry.workedSeconds)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {entry.activeTasks > 0
                    ? `▸ ${entry.activeTasks} tâche(s) en cours`
                    : 'aucune tâche en cours'}
                </Typography>
              </Paper>
            </Grid>
          ))}
        </Grid>
      )}

      <SectionTitle>Quantités réelles (toutes demandes)</SectionTitle>
      <Grid container spacing={2}>
        <CounterCard label="Pièces demandées" value={q.requestedQty} />
        <CounterCard label="Pièces reçues" value={q.receivedQty} />
        <CounterCard label="Pièces affectées" value={q.assignedQty} />
        <CounterCard label="Pièces traitées" value={q.processedQty} />
        <CounterCard label="Réparées" value={q.repairedQty} />
        <CounterCard label="Non réparables" value={q.irreparableQty} />
        <CounterCard label="Retournées au CQ" value={q.returnedQty} />
      </Grid>

      <Paper variant="outlined" className="p-4">
        <SectionTitle>Dernières opérations de retouche</SectionTitle>
        <Divider className="mb-1 mt-2" />
        {data.recentHistory.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Aucune opération enregistrée pour le moment.
          </Typography>
        ) : (
          <List dense>
            {data.recentHistory.map((entry) => (
              <ListItem key={entry.id} disableGutters>
                <ListItemText
                  primary={`${entry.action} — ${entry.entityType} #${entry.entityId}${
                    entry.actorNom ? ` — par ${entry.actorNom}` : ''
                  }`}
                  secondary={formatTimestamp(entry.createdAt)}
                />
              </ListItem>
            ))}
          </List>
        )}
      </Paper>
    </Stack>
  );
}
