import Alert from '@mui/material/Alert';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { RtDashboardDTO } from '@/types/retouche';

/**
 * Tableau de bord du retoucheur : compteurs calculés depuis les
 * données réelles de SQLite (demandes, interventions, quantités).
 */

function CounterCard({ label, value }: { label: string; value: number }) {
  return (
    <Grid size={{ xs: 6, sm: 4, md: 3 }}>
      <Paper variant="outlined" className="h-full p-3">
        <Typography variant="h4" component="p" color="primary">
          {value}
        </Typography>
        <Typography variant="body2">{label}</Typography>
      </Paper>
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
      <Paper variant="outlined" className="p-6">
        <Typography variant="h5" component="h2" gutterBottom>
          Bienvenue, {name}
        </Typography>
        <Stack direction="row" spacing={1} className="mb-1" useFlexGap>
          <Chip label="Retoucheur" color="primary" size="small" />
          <Chip label="Module Retouche" variant="outlined" size="small" />
        </Stack>
        <Typography color="text.secondary">
          Réception des demandes du Contrôle qualité, interventions de
          retouche et transmission au contrôle final.
        </Typography>
      </Paper>

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

      <Typography variant="h6" component="h3">
        Demandes et tâches
      </Typography>
      <Grid container spacing={2}>
        <CounterCard label="Demandes reçues du CQ" value={data.requestsCount} />
        <CounterCard label="En attente de réception" value={data.pendingReception} />
        <CounterCard label="En attente d’affectation" value={data.pendingAssignment} />
        <CounterCard label="Affectations en cours" value={data.assignmentsInProgress} />
        <CounterCard label="Interventions en cours" value={data.interventionsInProgress} />
      </Grid>

      <Typography variant="h6" component="h3">
        Quantités réelles (toutes demandes)
      </Typography>
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
        <Typography variant="h6" component="h3" gutterBottom>
          Dernières opérations de retouche
        </Typography>
        <Divider className="mb-1" />
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
