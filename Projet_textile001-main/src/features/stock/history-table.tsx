'use client';

import Alert from '@mui/material/Alert';
import LinearProgress from '@mui/material/LinearProgress';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { StAlertDTO, StHistoryDTO } from '@/types/stock';
import { useStockData } from './use-stock';

/**
 * Historique du module Stock et alertes du chef_stock : traçabilité
 * complète des opérations (utilisateur, action, avant/après, motif).
 */

interface HistoryPayload {
  history: StHistoryDTO[];
  alerts: StAlertDTO[];
}

export default function HistoryTable() {
  const { data, loading, error } = useStockData<HistoryPayload>(
    '/api/stock/dashboard',
  );

  return (
    <Stack spacing={3}>
      {loading ? <LinearProgress /> : null}
      {error ? <Alert severity="error">{error}</Alert> : null}

      <Typography variant="subtitle1">Alertes du stock</Typography>
      {(data?.alerts.length ?? 0) === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Aucune alerte.
        </Typography>
      ) : (
        data?.alerts.map((alert) => (
          <Alert key={alert.id} severity={alert.severity === 'critical' ? 'error' : 'warning'}>
            <Typography variant="body2">
              [{alert.category}] {alert.message} — statut : {alert.status} —{' '}
              {alert.createdAt}
            </Typography>
          </Alert>
        ))
      )}

      <Typography variant="subtitle1">Historique des opérations</Typography>
      {(data?.history.length ?? 0) === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Aucune opération enregistrée.
        </Typography>
      ) : (
        <Paper variant="outlined" className="p-3">
          <Stack spacing={0.5}>
            {data?.history.map((entry) => (
              <TextField
                key={entry.id}
                size="small"
                fullWidth
                multiline
                disabled
                value={`${entry.createdAt} — ${entry.action} — ${entry.entityType}#${entry.entityId} — par ${entry.actorNom ?? 'système'}${entry.reason ? ` — motif : ${entry.reason}` : ''}`}
              />
            ))}
          </Stack>
        </Paper>
      )}
    </Stack>
  );
}
