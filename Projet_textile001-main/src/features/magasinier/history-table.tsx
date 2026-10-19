'use client';

import Alert from '@mui/material/Alert';
import Chip from '@mui/material/Chip';
import LinearProgress from '@mui/material/LinearProgress';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { MgAlertDTO, MgHistoryDTO } from '@/types/magasinier';
import { useMagasinierData } from './use-magasinier';

/**
 * Historique du module Magasinier et alertes : traçabilité complète
 * des opérations (acteur, action, avant/après, motif).
 */

interface HistoryPayload {
  history: MgHistoryDTO[];
  alerts: MgAlertDTO[];
}

export default function HistoryTable() {
  const { data, loading, error } = useMagasinierData<HistoryPayload>(
    '/api/magasinier/historique',
  );

  return (
    <Stack spacing={3}>
      {loading ? <LinearProgress /> : null}
      {error ? <Alert severity="error">{error}</Alert> : null}

      <Typography variant="subtitle1">Alertes du magasin</Typography>
      {(data?.alerts.length ?? 0) === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Aucune alerte.
        </Typography>
      ) : (
        data?.alerts.map((alert) => (
          <Alert
            key={alert.id}
            severity={alert.severity === 'critical' ? 'error' : 'warning'}
          >
            <Typography variant="body2">
              [{alert.category}] {alert.message} — statut :{' '}
              <Chip size="small" label={alert.status} /> — {alert.createdAt}
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
