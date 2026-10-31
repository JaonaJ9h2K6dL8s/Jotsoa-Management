import Link from '@mui/material/Link';
import Alert from '@mui/material/Alert';
import Divider from '@mui/material/Divider';
import Grid from '@mui/material/Grid';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import {
  KpiCard,
  SectionTitle,
  WelcomeBanner,
  kpiTone,
} from '@/components/common/dashboard-kit';
import type { CoutureDashboardDTO } from '@/types/couture';
import {
  COUTURE_LOT_STATUS_LABELS,
  ASSIGNMENT_STATUS_LABELS,
} from '@/types/couture';

/**
 * Tableau de bord du chef de couture : compteurs calculés depuis les
 * données réelles de SQLite (statuts, quantités, incidents, alertes,
 * secondes validations en attente).
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
  return (
    <Grid size={{ xs: 6, sm: 4, md: 3 }}>
      <KpiCard label={label} value={value} href={href} tone={kpiTone(label.length)} />
    </Grid>
  );
}

function formatTimestamp(value: string): string {
  const date = new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z');
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

export default function CoutureDashboard({
  name,
  data,
}: {
  name: string;
  data: CoutureDashboardDTO;
}) {
  const lots = data.lotsByStatus;
  const assignments = data.assignmentsByStatus;
  return (
    <Stack spacing={3}>
      <WelcomeBanner
        name={name}
        roleLabel="Chef de couture"
        moduleLabel="Module Couture"
        description="Réceptions de la coupe, affectations aux salles et lignes, production réelle et transferts vers le contrôle qualité."
      />

      {data.criticalIncidents > 0 ? (
        <Alert severity="error">
          {data.criticalIncidents} incident(s) critique(s) non résolu(s) : les
          affectations concernées sont bloquées jusqu’à résolution.
        </Alert>
      ) : null}
      {data.pendingRequests > 0 ? (
        <Alert severity="warning">
          {data.pendingRequests} seconde(s) validation(s) en attente —
          <Link href="/couture/validations"> traiter les demandes</Link>.
        </Alert>
      ) : null}
      {data.openAlerts > 0 ? (
        <Alert severity="info">
          {data.openAlerts} alerte(s) ouverte(s) à examiner —
          <Link href="/couture/validations"> voir les alertes</Link>.
        </Alert>
      ) : null}

      <SectionTitle>Lots de couture</SectionTitle>
      <Grid container spacing={2}>
        {Object.keys(COUTURE_LOT_STATUS_LABELS).map((status) => (
          <CounterCard
            key={status}
            label={COUTURE_LOT_STATUS_LABELS[status as keyof typeof COUTURE_LOT_STATUS_LABELS]}
            value={lots[status] ?? 0}
            href="/couture/affectations"
          />
        ))}
      </Grid>

      <SectionTitle>Affectations</SectionTitle>
      <Grid container spacing={2}>
        {Object.keys(ASSIGNMENT_STATUS_LABELS).map((status) => (
          <CounterCard
            key={status}
            label={ASSIGNMENT_STATUS_LABELS[status as keyof typeof ASSIGNMENT_STATUS_LABELS]}
            value={assignments[status] ?? 0}
            href="/couture/affectations"
          />
        ))}
      </Grid>

      <SectionTitle>Quantités réelles</SectionTitle>
      <Grid container spacing={2}>
        <CounterCard label="Pièces reçues de la coupe" value={data.quantities.receivedQty} href="/couture/receptions" />
        <CounterCard label="Quantités contestées (écarts)" value={data.quantities.contestedQty} href="/couture/receptions" />
        <CounterCard label="Pièces affectées" value={data.quantities.assignedQty} href="/couture/affectations" />
        <CounterCard label="Pièces réellement cousues" value={data.quantities.sewnQty} href="/couture/production" />
        <CounterCard label="Restant à coudre" value={data.quantities.remainingToSew} href="/couture/production" />
        <CounterCard label="Transférées au contrôle qualité" value={data.quantities.transferredCqQty} href="/couture/transferts" />
        <CounterCard label="Incidents ouverts" value={data.openIncidents} href="/couture/incidents" />
        <CounterCard label="Alertes ouvertes" value={data.openAlerts} href="/couture/validations" />
      </Grid>

      {data.productionByLine.length > 0 ? (
        <Paper variant="outlined" className="p-4">
          <Typography variant="subtitle1" gutterBottom>
            Production par ligne de couture
          </Typography>
          <List dense>
            {data.productionByLine.map((line) => (
              <ListItem key={line.lineNom} disableGutters>
                <ListItemText primary={line.lineNom} secondary={`${line.qty} pièce(s) cousue(s)`} />
              </ListItem>
            ))}
          </List>
        </Paper>
      ) : null}

      <Paper variant="outlined" className="p-4">
        <SectionTitle>Dernières opérations de couture</SectionTitle>
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
