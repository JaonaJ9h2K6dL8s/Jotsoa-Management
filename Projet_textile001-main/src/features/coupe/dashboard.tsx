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
import type { CoupeDashboardDTO } from '@/server/coupe/dashboard';
import { ROLL_STATUS_LABELS } from '@/types/coupe';

/**
 * Tableau de bord du chef de coupe : compteurs calculés depuis les
 * données réelles de SQLite, alertes et dernières opérations.
 */

const TASK_STATUS_ORDER = [
  'a_faire',
  'en_cours',
  'terminee',
  'validee',
  'en_attente',
  'bloquee',
  'annulee',
  'a_verifier',
] as const;

function CounterCard({
  label,
  value,
  href,
  hint,
}: {
  label: string;
  value: number | string;
  href?: string;
  hint?: string;
}) {
  const content = (
    <Paper variant="outlined" className="h-full p-3">
      <Typography variant="h4" component="p" color="primary">
        {value}
      </Typography>
      <Typography variant="body2">{label}</Typography>
      {hint ? (
        <Typography variant="caption" color="text.secondary">
          {hint}
        </Typography>
      ) : null}
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

export default function CoupeDashboard({
  name,
  data,
}: {
  name: string;
  data: CoupeDashboardDTO;
}) {
  const lots = data.lotsByStatus;
  const tasks = data.tasksByStatus;
  const rolls = data.rollsByStatus;
  return (
    <Stack spacing={3}>
      <Paper variant="outlined" className="p-6">
        <Typography variant="h5" component="h2" gutterBottom>
          Bienvenue, {name}
        </Typography>
        <Stack direction="row" spacing={1} className="mb-1" useFlexGap>
          <Chip label="Chef de coupe" color="primary" size="small" />
          <Chip label="Module Coupe" variant="outlined" size="small" />
        </Stack>
        <Typography color="text.secondary">
          Suivi des rouleaux, lots, tâches et transferts vers la couture.
          Les indicateurs reflètent les données réelles de la base.
        </Typography>
      </Paper>

      {data.rollsLowWeight.length > 0 ? (
        <Alert severity="warning">
          {data.rollsLowWeight.length} rouleau(s) avec un poids restant inférieur
          à 9 kg : vérifiez leur état avant toute nouvelle affectation.
        </Alert>
      ) : null}

      <Typography variant="h6" component="h3">
        Lots et transferts
      </Typography>
      <Grid container spacing={2}>
        <CounterCard label="Lots en cours" value={lots['en_cours'] ?? 0} href="/coupe/lots" />
        <CounterCard label="Lots bloqués" value={lots['bloque'] ?? 0} href="/coupe/lots" />
        <CounterCard
          label="En attente de validation"
          value={lots['attente_validation'] ?? 0}
          href="/coupe/lots"
        />
        <CounterCard
          label="Prêts pour transfert"
          value={lots['pret_transfert'] ?? 0}
          href="/coupe/lots"
        />
        <CounterCard label="Lots transférés" value={lots['transfere'] ?? 0} href="/coupe/lots" />
        <CounterCard label="Transferts effectués" value={data.transfers.count} />
      </Grid>

      <Typography variant="h6" component="h3">
        Tâches de coupe
      </Typography>
      <Grid container spacing={2}>
        {TASK_STATUS_ORDER.map((status) => (
          <CounterCard
            key={status}
            label={status === 'validee' ? 'Tâches validées' : `Tâches : ${status.replace('_', ' ')}`}
            value={tasks[status] ?? 0}
          />
        ))}
      </Grid>

      <Typography variant="h6" component="h3">
        Production et rouleaux
      </Typography>
      <Grid container spacing={2}>
        <CounterCard label="Pièces prévues (validées)" value={data.quantities.plannedQty} />
        <CounterCard label="Pièces réellement coupées" value={data.quantities.cutQty} />
        <CounterCard label="Pièces utilisables" value={data.quantities.usableQty} />
        <CounterCard label="Pièces en anomalie" value={data.quantities.anomalyQty} />
        <CounterCard label="Déclarations de déchets" value={data.waste.count} href="/coupe/dechets" />
        <CounterCard label="Rouleaux disponibles" value={rolls['disponible'] ?? 0} href="/coupe/rouleaux" />
        <CounterCard label="Rouleaux en utilisation" value={rolls['en_utilisation'] ?? 0} href="/coupe/rouleaux" />
        <CounterCard label="Rouleaux bloqués ou défectueux" value={(rolls['bloque'] ?? 0) + (rolls['defectueux'] ?? 0)} href="/coupe/rouleaux" />
      </Grid>

      {data.rollsLowWeight.length > 0 ? (
        <Paper variant="outlined" className="p-4">
          <Typography variant="subtitle1" gutterBottom>
            Rouleaux à vérifier (poids restant &lt; 9 kg)
          </Typography>
          <List dense>
            {data.rollsLowWeight.map((roll) => (
              <ListItem key={roll.id} disableGutters>
                <ListItemText
                  primary={`${roll.code} — ${roll.fabricRef}`}
                  secondary={`Restant : ${roll.remainingWeightKg} kg — ${ROLL_STATUS_LABELS[roll.status]}`}
                />
              </ListItem>
            ))}
          </List>
        </Paper>
      ) : null}

      <Paper variant="outlined" className="p-4">
        <Typography variant="h6" component="h3" gutterBottom>
          Dernières opérations de coupe
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
