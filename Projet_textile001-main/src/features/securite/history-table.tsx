'use client';

import Alert from '@mui/material/Alert';
import Chip from '@mui/material/Chip';
import LinearProgress from '@mui/material/LinearProgress';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useSecuriteData } from './use-securite';

/**
 * Historique du module Sécurité et alertes : traçabilité complète des
 * contrôles, décisions, contre-vérifications et sorties.
 */

interface HistoryPayload {
  history: Array<{
    id: number;
    action: string;
    entityType: string;
    entityId: number;
    actorNom: string | null;
    oldValue: string | null;
    newValue: string | null;
    reason: string | null;
    createdAt: string;
  }>;
  alerts: Array<{
    id: number;
    category: string;
    severity: string;
    message: string;
    status: string;
    createdAt: string;
  }>;
}

export default function SecuriteHistoryTable() {
  const { data, loading, error } = useSecuriteData<HistoryPayload>(
    '/api/securite/historique',
  );

  return (
    <Stack spacing={3}>
      {loading ? <LinearProgress /> : null}
      {error ? <Alert severity="error">{error}</Alert> : null}

      <Typography variant="subtitle1">Alertes sécurité</Typography>
      {(data?.alerts.length ?? 0) === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Aucune alerte.
        </Typography>
      ) : (
        data?.alerts.map((alert) => (
          <Alert key={alert.id} severity={alert.severity === 'critical' ? 'error' : 'warning'}>
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
