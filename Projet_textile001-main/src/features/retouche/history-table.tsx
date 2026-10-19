'use client';

import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import LinearProgress from '@mui/material/LinearProgress';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { AlertDTO, RtHistoryDTO } from '@/types/retouche';
import { sendRt, useRtData } from './use-retouche';

/**
 * Historique du module Retouche (lecture seule) et alertes avec
 * transitions contrôlées. Les traces ne sont ni modifiables ni
 * supprimables depuis l'application.
 */

const ALERT_STATUS: Record<string, string> = {
  nouvelle: 'Nouvelle',
  en_cours: 'En cours',
  resolue: 'Résolue',
  cloturee: 'Clôturée',
};

function formatTimestamp(value: string): string {
  const date = new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z');
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

export default function HistoryTable() {
  const [entityType, setEntityType] = useState('');
  const query = entityType ? `?entityType=${entityType}` : '';
  const history = useRtData<RtHistoryDTO[]>(
    `/api/retouche/history${query || ''}`,
  );
  const alerts = useRtData<AlertDTO[]>('/api/retouche/history?resource=alerts');
  const [message, setMessage] = useState<string | null>(null);

  const patchAlert = async (alert: AlertDTO, status: string) => {
    try {
      await sendRt('/api/retouche/history', 'PATCH', {
        id: alert.id,
        status,
        resolution: `Statut changé en ${ALERT_STATUS[status] ?? status}.`,
      });
      setMessage(`Alerte #${alert.id} mise à jour.`);
      void alerts.refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Erreur inattendue.');
    }
  };

  return (
    <Stack spacing={3}>
      {history.loading || alerts.loading ? <LinearProgress /> : null}
      {history.error ? <Alert severity="error">{history.error}</Alert> : null}
      {alerts.error ? <Alert severity="error">{alerts.error}</Alert> : null}
      {message ? <Alert severity="success">{message}</Alert> : null}

      <Typography variant="subtitle1">Alertes</Typography>
      {(alerts.data?.length ?? 0) === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Aucune alerte.
        </Typography>
      ) : (
        alerts.data?.map((alert) => (
          <Paper key={alert.id} variant="outlined" className="p-3">
            <Stack direction="row" spacing={1} alignItems="center" useFlexGap>
              <Typography variant="body1">
                #{alert.id} — {alert.category}
              </Typography>
              <Chip
                size="small"
                color={
                  alert.severity === 'critical'
                    ? 'error'
                    : alert.severity === 'warning'
                      ? 'warning'
                      : 'default'
                }
                label={alert.severity}
              />
              <Chip
                size="small"
                variant="outlined"
                label={ALERT_STATUS[alert.status] ?? alert.status}
              />
            </Stack>
            <Typography variant="body2" color="text.secondary">
              {alert.message}
            </Typography>
            {['nouvelle', 'en_cours'].includes(alert.status) ? (
              <Stack direction="row" spacing={1}>
                {alert.status === 'nouvelle' ? (
                  <Button size="small" onClick={() => patchAlert(alert, 'en_cours')}>
                    Prendre en charge
                  </Button>
                ) : null}
                <Button
                  size="small"
                  variant="contained"
                  onClick={() => patchAlert(alert, 'resolue')}
                >
                  Résoudre
                </Button>
                <Button size="small" onClick={() => patchAlert(alert, 'cloturee')}>
                  Clôturer
                </Button>
              </Stack>
            ) : null}
          </Paper>
        ))
      )}

      <Typography variant="subtitle1">Historique des opérations</Typography>
      <TextField
        select
        label="Type d'entité"
        size="small"
        value={entityType}
        onChange={(event) => setEntityType(event.target.value)}
        sx={{ maxWidth: 260 }}
      >
        <MenuItem value="">Tous</MenuItem>
        {[
          'cq_rework_request',
          'rt_assignment',
          'rt_intervention',
          'rt_return',
          'rt_rebut_proposal',
        ].map((value) => (
          <MenuItem key={value} value={value}>
            {value}
          </MenuItem>
        ))}
      </TextField>
      <Paper variant="outlined" className="p-3">
        {(history.data?.length ?? 0) === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Aucun événement pour ces filtres.
          </Typography>
        ) : (
          <List dense>
            {history.data?.map((entry) => (
              <ListItem key={entry.id} disableGutters>
                <ListItemText
                  primary={`${entry.action} — ${entry.entityType} #${entry.entityId}${
                    entry.actorNom ? ` — par ${entry.actorNom}` : ''
                  }`}
                  secondary={
                    <>
                      {formatTimestamp(entry.createdAt)}
                      {entry.oldValue ? ` — avant : ${entry.oldValue}` : ''}
                      {entry.newValue ? ` — après : ${entry.newValue}` : ''}
                      {entry.reason ? ` — motif : ${entry.reason}` : ''}
                    </>
                  }
                />
              </ListItem>
            ))}
          </List>
        )}
      </Paper>
    </Stack>
  );
}
