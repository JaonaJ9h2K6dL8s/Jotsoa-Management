import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
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
import { getDashboardData } from '@/server/config/dashboard';
import { requirePageRole } from '@/server/auth/guards';

export const metadata = { title: 'Administration' };

const ACTION_LABELS: Record<string, string> = {
  CONFIG_CREATED: 'Configuration créée',
  CONFIG_UPDATED: 'Configuration modifiée',
  CONFIG_ACTIVATED: 'Configuration activée',
  CONFIG_DEACTIVATED: 'Configuration désactivée',
  SETTINGS_UPDATED: 'Paramètres modifiés',
  USER_CREATED: 'Utilisateur créé',
  ROLE_CHANGED: 'Rôle modifié',
  PASSWORD_RESET: 'Mot de passe réinitialisé',
  USER_DEACTIVATED: 'Compte désactivé',
};

function formatTimestamp(value: string): string {
  const date = new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z');
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

function CounterCard({
  label,
  value,
  href,
  hint,
}: {
  label: string;
  value: number;
  href?: string;
  hint?: string;
}) {
  return (
    <Grid size={{ xs: 6, sm: 4, md: 3 }}>
      <KpiCard label={label} value={value} href={href} hint={hint} tone={kpiTone(label.length)} />
    </Grid>
  );
}

export default async function AdminDashboard() {
  const user = await requirePageRole('admin');
  const data = getDashboardData();
  const name = user.prenom ? `${user.prenom} ${user.nom}` : user.nom;

  return (
    <Stack spacing={3}>
      <WelcomeBanner
        name={name}
        roleLabel="Administrateur"
        moduleLabel="Configuration générale"
        description="Tableau de bord global de l'entreprise. Les compteurs reflètent les données réelles de la base."
      />

      {data.alerts.length > 0 ? (
        <Stack spacing={1}>
          {data.alerts.map((alert) => (
            <Alert key={alert.message} severity={alert.level}>
              {alert.message}
            </Alert>
          ))}
        </Stack>
      ) : null}

      <SectionTitle>Compteurs de configuration</SectionTitle>
      <Grid container spacing={2}>
        <CounterCard label="Utilisateurs actifs" value={data.counters.usersActive} href="/admin/utilisateurs" />
        <CounterCard label="Comptes désactivés" value={data.counters.usersInactive} href="/admin/utilisateurs" />
        <CounterCard label="Types de produits" value={data.counters.productTypes} href="/admin/produits" />
        <CounterCard
          label="Produits configurés"
          value={data.counters.products}
          hint="Module non encore disponible"
        />
        <CounterCard label="Couleurs" value={data.counters.colors} href="/admin/couleurs" />
        <CounterCard label="Tailles" value={data.counters.sizes} href="/admin/tailles" />
        <CounterCard label="Zones de retouche" value={data.counters.reworkZones} href="/admin/zones-retouche" />
        <CounterCard label="Défauts qualité" value={data.counters.defects} href="/admin/defauts" />
        <CounterCard label="Salles de couture" value={data.counters.sewingRooms} href="/admin/couture" />
        <CounterCard label="Lignes de couture" value={data.counters.sewingLines} href="/admin/couture" />
        <CounterCard label="Cadences actives configurées" value={data.counters.cadences} href="/admin/cadences" />
      </Grid>

      <Paper variant="outlined" className="p-4">
        <SectionTitle>Dernières opérations administratives</SectionTitle>
        <Divider className="mb-1 mt-2" />
        {data.recentOperations.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Aucune opération enregistrée pour le moment.
          </Typography>
        ) : (
          <List dense>
            {data.recentOperations.map((operation) => (
              <ListItem key={operation.id} disableGutters>
                <ListItemText
                  primary={`${ACTION_LABELS[operation.action] ?? operation.action}${
                    operation.actor ? ` — par ${operation.actor}` : ''
                  }`}
                  secondary={formatTimestamp(operation.createdAt)}
                />
              </ListItem>
            ))}
          </List>
        )}
      </Paper>

      <Box>
        <Typography variant="body2" color="text.secondary">
          Les modules métier (coupe, couture, contrôle qualité, retouche,
          stock, magasin, sécurité) seront activés progressivement dans les
          prochaines étapes.
        </Typography>
      </Box>
    </Stack>
  );
}
