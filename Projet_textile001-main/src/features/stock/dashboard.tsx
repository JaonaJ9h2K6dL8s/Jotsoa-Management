'use client';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import LinearProgress from '@mui/material/LinearProgress';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { StDashboardDTO } from '@/types/stock';
import { useStockData } from './use-stock';

/**
 * Tableau de bord du stock : uniquement des données réelles (cartons,
 * entrées CQ en attente, inventaires, ajustements, alertes, déchets).
 */

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

export default function StockDashboard({ name }: { name: string }) {
  const { data, loading, error } = useStockData<{ item: StDashboardDTO }>(
    '/api/stock/dashboard',
  );
  const dash = data?.item ?? null;

  return (
    <Stack spacing={3}>
      <Typography variant="h5">Bienvenue, {name}</Typography>
      <Typography variant="body2" color="text.secondary">
        Espace de gestion des cartons et du stock des vêtements finis.
      </Typography>
      {loading ? <LinearProgress /> : null}
      {error ? <Alert severity="error">{error}</Alert> : null}
      {dash ? (
        <>
          <Box className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Cartons en stock" value={dash.cartonsInStock} />
            <Metric label="Cartons en remplissage" value={dash.cartonsFilling} />
            <Metric label="Cartons bloqués" value={dash.cartonsBlocked} />
            <Metric
              label="Pièces disponibles (tous lots)"
              value={dash.totalPiecesInStock}
            />
            <Metric label="Entrées CQ à réceptionner" value={dash.pendingCqTransfers} />
            <Metric label="Emplacements actifs" value={dash.locationsCount} />
            <Metric label="Inventaires en cours" value={dash.inventoriesInProgress} />
            <Metric
              label="Ajustements en attente de validation"
              value={dash.pendingAdjustments}
            />
          </Box>
          {dash.openAlerts > 0 ? (
            <Alert severity="warning">
              {dash.openAlerts} alerte(s) ouverte(s) concernent le stock.
            </Alert>
          ) : null}

          <Typography variant="subtitle1">Stock disponible par lot et taille</Typography>
          {dash.balances.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              Aucun stock disponible pour le moment.
            </Typography>
          ) : (
            <Paper variant="outlined" className="p-3">
              <Stack spacing={1}>
                {dash.balances.map((balance) => (
                  <Stack
                    key={`${balance.lotId}-${balance.sizeId}`}
                    direction="row"
                    spacing={1}
                    alignItems="center"
                    useFlexGap
                  >
                    <Typography variant="body2">
                      {balance.lotCode} — {balance.productNom} ({balance.colorNom}) —
                      taille {balance.sizeLabel} :
                    </Typography>
                    <Chip
                      size="small"
                      color={balance.inStock > 0 ? 'success' : 'default'}
                      label={`${balance.inStock} pièce(s)`}
                    />
                  </Stack>
                ))}
              </Stack>
            </Paper>
          )}

          <Typography variant="subtitle1">
            Déchets textiles (stock distinct, en kg)
          </Typography>
          {dash.waste.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              Aucun déchet enregistré par la Coupe.
            </Typography>
          ) : (
            <Paper variant="outlined" className="p-3">
              <Stack spacing={1}>
                {dash.waste.map((waste) => (
                  <Typography key={waste.wasteType} variant="body2">
                    {waste.wasteType} : {waste.totalKg} kg enregistrés —{' '}
                    {waste.availableKg} kg disponibles ({waste.outKg} kg sortis)
                  </Typography>
                ))}
              </Stack>
            </Paper>
          )}

          <Typography variant="subtitle1">Dernières opérations</Typography>
          {dash.recentHistory.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              Aucune opération enregistrée.
            </Typography>
          ) : (
            <Paper variant="outlined" className="p-3">
              <Stack spacing={0.5}>
                {dash.recentHistory.map((entry) => (
                  <Typography key={entry.id} variant="caption" color="text.secondary">
                    {entry.createdAt} — {entry.action} —{' '}
                    {entry.actorNom ?? 'système'}
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
