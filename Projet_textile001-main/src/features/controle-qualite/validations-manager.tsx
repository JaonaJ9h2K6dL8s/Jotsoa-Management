'use client';

import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import LinearProgress from '@mui/material/LinearProgress';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { AlertDTO, SensitiveRequestDTO } from '@/types/cq';
import { sendCq, useCqData } from './use-cq';

/**
 * Secondes validations (décisions de rebut) et alertes du module.
 * L'auteur d'une demande ne peut jamais la traiter lui-même — la règle
 * est appliquée côté serveur par le mécanisme central.
 */

const REQUEST_STATUS: Record<string, { label: string; color: 'success' | 'error' | 'warning' | 'default' }> = {
  en_attente: { label: 'En attente', color: 'warning' },
  approuvee: { label: 'Approuvée', color: 'success' },
  refusee: { label: 'Refusée', color: 'error' },
  expiree: { label: 'Expirée', color: 'default' },
};

const ALERT_STATUS: Record<string, string> = {
  nouvelle: 'Nouvelle',
  en_cours: 'En cours',
  resolue: 'Résolue',
  cloturee: 'Clôturée',
};

function DecideDialog({
  request,
  decision,
  onClose,
  onDone,
}: {
  request: SensitiveRequestDTO;
  decision: 'approve' | 'refuse';
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await sendCq('/api/controle-qualite/sensitive', 'POST', {
        requestId: request.id,
        decision,
        note: note || null,
      });
      onDone(
        decision === 'approve'
          ? `Demande #${request.id} approuvée et appliquée.`
          : `Demande #${request.id} refusée.`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur inattendue.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>
        {decision === 'approve' ? 'Approuver' : 'Refuser'} la demande #
        {request.id}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} className="pt-2">
          <Typography variant="body2" color="text.secondary">
            {request.reason} — motif : {request.reason}
          </Typography>
          <TextField
            label={
              decision === 'refuse'
                ? 'Commentaire obligatoire'
                : 'Commentaire (facultatif)'
            }
            size="small"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          {error ? <Alert severity="error">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annuler</Button>
        <Button
          variant="contained"
          color={decision === 'approve' ? 'primary' : 'error'}
          onClick={submit}
          disabled={busy || (decision === 'refuse' && !note.trim())}
        >
          Confirmer
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default function ValidationsManager() {
  const requests = useCqData<SensitiveRequestDTO[]>(
    '/api/controle-qualite/sensitive',
  );
  const alerts = useCqData<AlertDTO[]>('/api/controle-qualite/alerts');
  const [message, setMessage] = useState<string | null>(null);
  const [dialog, setDialog] = useState<
    { request: SensitiveRequestDTO; decision: 'approve' | 'refuse' } | null
  >(null);

  const decide = async (
    request: SensitiveRequestDTO,
    decision: 'approve' | 'refuse',
  ) => {
    try {
      await sendCq('/api/controle-qualite/sensitive', 'POST', {
        requestId: request.id,
        decision,
        note: decision === 'approve' ? 'Approuvé.' : 'Refusé.',
      });
      setMessage(`Demande #${request.id} traitée.`);
      void requests.refresh();
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : 'Erreur inattendue.',
      );
    }
  };

  const patchAlert = async (alert: AlertDTO, status: string) => {
    try {
      await sendCq('/api/controle-qualite/alerts', 'PATCH', {
        id: alert.id,
        status,
        resolution: `Statut changé en ${ALERT_STATUS[status] ?? status}.`,
      });
      setMessage(`Alerte #${alert.id} mise à jour.`);
      void alerts.refresh();
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : 'Erreur inattendue.',
      );
    }
  };

  return (
    <Stack spacing={3}>
      {requests.loading || alerts.loading ? <LinearProgress /> : null}
      {requests.error ? <Alert severity="error">{requests.error}</Alert> : null}
      {alerts.error ? <Alert severity="error">{alerts.error}</Alert> : null}
      {message ? <Alert severity="success">{message}</Alert> : null}

      <Typography variant="subtitle1">
        Secondes validations (rebut)
      </Typography>
      {(requests.data?.length ?? 0) === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Aucune demande de seconde validation.
        </Typography>
      ) : (
        requests.data?.map((request) => {
          const status = REQUEST_STATUS[request.status] ?? {
            label: request.status,
            color: 'default' as const,
          };
          return (
            <Paper key={request.id} variant="outlined" className="p-3">
              <Stack direction="row" spacing={1} alignItems="center" useFlexGap>
                <Typography variant="body1">
                  #{request.id} — {request.action} — entité{' '}
                  {request.entityType} #{request.entityId}
                </Typography>
                <Chip size="small" color={status.color} label={status.label} />
              </Stack>
              <Typography variant="caption" color="text.secondary">
                Motif : {request.reason} — par {request.requestedByName ?? '—'}
                {request.decidedByName
                  ? ` — décidée par ${request.decidedByName}`
                  : ''}
              </Typography>
              {request.status === 'en_attente' ? (
                <Stack direction="row" spacing={1}>
                  <Button
                    size="small"
                    variant="contained"
                    onClick={() => decide(request, 'approve')}
                  >
                    Approuver
                  </Button>
                  <Button
                    size="small"
                    color="error"
                    onClick={() => setDialog({ request, decision: 'refuse' })}
                  >
                    Refuser
                  </Button>
                </Stack>
              ) : null}
            </Paper>
          );
        })
      )}

      <Typography variant="subtitle1">Alertes ouvertes</Typography>
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
              <Chip size="small" variant="outlined" label={ALERT_STATUS[alert.status] ?? alert.status} />
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

      {dialog ? (
        <DecideDialog
          request={dialog.request}
          decision={dialog.decision}
          onClose={() => setDialog(null)}
          onDone={(text) => {
            setDialog(null);
            setMessage(text);
            void requests.refresh();
          }}
        />
      ) : null}
    </Stack>
  );
}
