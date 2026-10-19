'use client';

import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import LinearProgress from '@mui/material/LinearProgress';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { AlertDTO, SensitiveRequestDTO } from '@/types/couture';
import { sendCouture, useCoutureData } from './use-couture';

/**
 * File des secondes validations (opérations sensibles) et alertes du
 * module. L'auteur d'une demande ne peut pas la traiter lui-même :
 * le serveur refuse toute auto-approbation.
 */

const ACTION_LABELS: Record<string, string> = {
  correction_production: 'Correction d’une production',
  annulation_production: 'Annulation d’une production',
  annulation_transfert_couture: 'Annulation d’un transfert CQ',
};

function RequestRow({ request, onDone }: { request: SensitiveRequestDTO; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const decide = async (decision: 'approve' | 'refuse') => {
    setError(null);
    try {
      await sendCouture('/api/couture/sensitive', 'POST', {
        requestId: request.id,
        decision,
        note,
      });
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur inattendue.');
    }
  };
  let payloadSummary = request.payload;
  try {
    payloadSummary = JSON.stringify(JSON.parse(request.payload));
  } catch {
    /* payload affiché brut */
  }
  return (
    <Paper variant="outlined" className="p-3">
      <Stack spacing={1}>
        <Stack direction="row" spacing={1} alignItems="center" useFlexGap>
          <Typography variant="body1">Demande #{request.id}</Typography>
          <Chip size="small" color="warning" label={ACTION_LABELS[request.action] ?? request.action} />
          <Chip
            size="small"
            label={
              request.status === 'en_attente'
                ? 'En attente'
                : request.status === 'approuvee'
                  ? 'Approuvée'
                  : request.status === 'refusee'
                    ? 'Refusée'
                    : 'Expirée'
            }
          />
        </Stack>
        <Typography variant="body2" color="text.secondary">
          {request.entityType} #{request.entityId} — demandée par{' '}
          {request.requestedByName ?? '—'} le {request.requestedAt} — motif :{' '}
          {request.reason}
        </Typography>
        <Typography variant="caption" color="text.secondary" className="break-all">
          {payloadSummary}
        </Typography>
        {request.decisionNote ? (
          <Typography variant="caption" color="text.secondary">
            Décision : {request.decisionNote}
          </Typography>
        ) : null}
        {request.status === 'en_attente' ? (
          <Stack direction="row" spacing={1} alignItems="center" useFlexGap>
            <TextField
              label="Commentaire"
              size="small"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
            <Button
              size="small"
              color="success"
              variant="contained"
              onClick={() => decide('approve')}
            >
              Approuver
            </Button>
            <Button
              size="small"
              color="error"
              onClick={() => decide('refuse')}
              disabled={!note.trim()}
            >
              Refuser
            </Button>
          </Stack>
        ) : null}
        {error ? <Alert severity="error">{error}</Alert> : null}
      </Stack>
    </Paper>
  );
}

function AlertRow({ alert, onDone }: { alert: AlertDTO; onDone: () => void }) {
  const [resolution, setResolution] = useState('');
  const act = async (status: string) => {
    try {
      await sendCouture('/api/couture/alerts', 'PATCH', {
        id: alert.id,
        status,
        resolution: resolution || undefined,
      });
      onDone();
    } catch {
      /* le message d'erreur serveur est affiché par la liste */
    }
  };
  return (
    <Paper variant="outlined" className="p-3">
      <Stack spacing={1}>
        <Stack direction="row" spacing={1} alignItems="center" useFlexGap>
          <Chip
            size="small"
            color={alert.severity === 'critical' ? 'error' : alert.severity === 'warning' ? 'warning' : 'info'}
            label={alert.category}
          />
          <Chip size="small" label={alert.status} />
        </Stack>
        <Typography variant="body2">{alert.message}</Typography>
        <Typography variant="caption" color="text.secondary">
          {alert.createdAt}
          {alert.resolution ? ` — résolution : ${alert.resolution}` : ''}
        </Typography>
        {!['resolue', 'cloturee'].includes(alert.status) ? (
          <Stack direction="row" spacing={1} alignItems="center" useFlexGap>
            <TextField
              label="Résolution"
              size="small"
              value={resolution}
              onChange={(event) => setResolution(event.target.value)}
            />
            <Button size="small" onClick={() => act('en_cours')}>Prendre en charge</Button>
            <Button
              size="small"
              color="success"
              onClick={() => act('resolue')}
              disabled={!resolution.trim()}
            >
              Résoudre
            </Button>
          </Stack>
        ) : null}
        {alert.status === 'resolue' ? (
          <Button size="small" onClick={() => act('cloturee')}>Clôturer</Button>
        ) : null}
      </Stack>
    </Paper>
  );
}

export default function ValidationsManager() {
  const requests = useCoutureData<SensitiveRequestDTO[]>('/api/couture/sensitive');
  const alerts = useCoutureData<AlertDTO[]>('/api/couture/alerts');

  return (
    <Stack spacing={3}>
      {requests.loading || alerts.loading ? <LinearProgress /> : null}
      {requests.error ? <Alert severity="error">{requests.error}</Alert> : null}
      {alerts.error ? <Alert severity="error">{alerts.error}</Alert> : null}

      <Stack spacing={1}>
        <Typography variant="subtitle1">Secondes validations</Typography>
        {(requests.data ?? []).length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Aucune demande de seconde validation.
          </Typography>
        ) : (
          (requests.data ?? []).map((request) => (
            <RequestRow
              key={request.id}
              request={request}
              onDone={() => {
                void requests.refresh();
                void alerts.refresh();
              }}
            />
          ))
        )}
      </Stack>

      <Stack spacing={1}>
        <Typography variant="subtitle1">Alertes</Typography>
        {(alerts.data ?? []).length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Aucune alerte.
          </Typography>
        ) : (
          (alerts.data ?? []).map((alert) => (
            <AlertRow
              key={alert.id}
              alert={alert}
              onDone={() => void alerts.refresh()}
            />
          ))
        )}
      </Stack>
    </Stack>
  );
}
