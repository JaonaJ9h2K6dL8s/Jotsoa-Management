import Link from '@mui/material/Link';
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
import type { CqDashboardDTO } from '@/types/cq';
import { CONTROL_STATUS_LABELS } from '@/types/cq';

/**
 * Tableau de bord du contrôleur qualité : compteurs calculés depuis
 * les données réelles de SQLite (réceptions, contrôles, quantités,
 * taux de conformité, secondes validations, alertes).
 */

function CounterCard({
  label,
  value,
  href,
}: {
  label: string;
  value: number | string;
  href?: string;
}) {
  const content = (
    <Paper variant="outlined" className="h-full p-3">
      <Typography variant="h4" component="p" color="primary">
        {value}
      </Typography>
      <Typography variant="body2">{label}</Typography>
    </Paper>
  );
  return (
    <Grid size={{ xs: 6, sm: 4, md: 3 }}>
      {href ? (
        <Link href={href} underline="none" color="inherit">
          {content}
        </Link>
      ) : (
        content
      )}
    </Grid>
  );
}

function formatTimestamp(value: string): string {
  const date = new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z');
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

export default function ControleQualiteDashboard({
  name,
  data,
}: {
  name: string;
  data: CqDashboardDTO;
}) {
  const q = data.quantities;
  return (
    <Stack spacing={3}>
      <Paper variant="outlined" className="p-6">
        <Typography variant="h5" component="h2" gutterBottom>
          Bienvenue, {name}
        </Typography>
        <Stack direction="row" spacing={1} className="mb-1" useFlexGap>
          <Chip label="Contrôleur qualité" color="primary" size="small" />
          <Chip label="Module Contrôle qualité" variant="outlined" size="small" />
        </Stack>
        <Typography color="text.secondary">
          Réception des transferts de la couture, contrôles, défauts,
          décisions de conformité et préparation des transferts vers le stock.
        </Typography>
      </Paper>

      {data.pendingRequests > 0 ? (
        <Alert severity="warning">
          {data.pendingRequests} décision(s) de rebut en attente de seconde
          validation — <Link href="/controle-qualite/validations">traiter</Link>.
        </Alert>
      ) : null}
      {data.openAlerts > 0 ? (
        <Alert severity="info">
          {data.openAlerts} alerte(s) ouverte(s) à examiner —{' '}
          <Link href="/controle-qualite/validations">voir les alertes</Link>.
        </Alert>
      ) : null}

      <Typography variant="h6" component="h3">
        Contrôles par statut
      </Typography>
      <Grid container spacing={2}>
        {Object.keys(CONTROL_STATUS_LABELS).map((status) => (
          <CounterCard
            key={status}
            label={CONTROL_STATUS_LABELS[status as keyof typeof CONTROL_STATUS_LABELS]}
            value={data.controlsByStatus[status] ?? 0}
            href="/controle-qualite/controles"
          />
        ))}
      </Grid>

      <Typography variant="h6" component="h3">
        Quantités réelles
      </Typography>
      <Grid container spacing={2}>
        <CounterCard label="Transferts reçus" value={data.receptionsCount} href="/controle-qualite/receptions" />
        <CounterCard label="Pièces reçues" value={q.receivedQty} href="/controle-qualite/receptions" />
        <CounterCard label="Pièces inspectées" value={q.inspectedQty} href="/controle-qualite/controles" />
        <CounterCard label="Pièces en attente" value={q.pendingQty} href="/controle-qualite/controles" />
        <CounterCard label="Pièces conformes" value={q.conformeQty} href="/controle-qualite/controles" />
        <CounterCard label="Pièces défectueuses" value={q.defautQty} href="/controle-qualite/defauts" />
        <CounterCard label="À retoucher" value={q.reworkQty} href="/controle-qualite/retouches" />
        <CounterCard label="Rebutées" value={q.rebutQty} href="/controle-qualite/defauts" />
        <CounterCard
          label="Prêtes pour le stock"
          value={q.availableStockQty}
          href="/controle-qualite/transferts"
        />
        <CounterCard
          label="Transférées au stock"
          value={q.transferredStockQty}
          href="/controle-qualite/transferts"
        />
        <CounterCard
          label="Demandes de retouche en attente"
          value={data.pendingReworkRequests}
          href="/controle-qualite/retouches"
        />
        <CounterCard
          label="Taux de conformité"
          value={data.conformanceRate === null ? 'Non applicable' : `${data.conformanceRate} %`}
          href="/controle-qualite/controles"
        />
      </Grid>

      <Paper variant="outlined" className="p-4">
        <Typography variant="h6" component="h3" gutterBottom>
          Dernières opérations de contrôle qualité
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
