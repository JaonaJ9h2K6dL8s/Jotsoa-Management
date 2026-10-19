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
import type { RtReceptionDTO, RtRequestDTO } from '@/types/retouche';
import { RT_STATUS_LABELS } from '@/types/retouche';
import { sendRt, useRtData } from './use-retouche';

/**
 * Demandes de retouche reçues du Contrôle qualité et leur réception.
 * Les quantités reçues sont saisies par taille ; tout écart est
 * alerté et reste distinct de la quantité demandée.
 */

interface RequestsPayload {
  requests: RtRequestDTO[];
  receptions: RtReceptionDTO[];
}

function ReceiveDialog({
  request,
  onClose,
  onDone,
}: {
  request: RtRequestDTO;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [received, setReceived] = useState<Record<number, string>>(
    Object.fromEntries(request.lines.map((line) => [line.sizeId, String(line.requestedQty)])),
  );
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await sendRt('/api/retouche/requests', 'POST', {
        action: 'receive',
        requestId: request.id,
        notes: notes || null,
        lines: request.lines.map((line) => ({
          sizeId: line.sizeId,
          receivedQty: received[line.sizeId] ?? '0',
        })),
      });
      onDone(`Demande ${request.code} réceptionnée.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur inattendue.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        Réception de la demande {request.code} — lot {request.lotCode}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} className="pt-2">
          <Typography variant="body2" color="text.secondary">
            {request.productNom} — {request.colorNom}. Motif : {request.reason}
            {request.origin === 'final'
              ? ' (retouche répétée après contrôle final)'
              : ''}
          </Typography>
          {request.lines.map((line) => (
            <TextField
              key={line.sizeId}
              label={`Quantité reçue — taille ${line.sizeLabel} (demandé : ${line.requestedQty})`}
              type="number"
              size="small"
              value={received[line.sizeId] ?? '0'}
              inputProps={{ min: 0, max: line.requestedQty, step: 'any' }}
              onChange={(event) =>
                setReceived((prev) => ({ ...prev, [line.sizeId]: event.target.value }))
              }
            />
          ))}
          <TextField
            label="Observations (facultatif)"
            size="small"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
          {error ? <Alert severity="error">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annuler</Button>
        <Button variant="contained" onClick={submit} disabled={busy}>
          Confirmer la réception
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default function RequestsManager() {
  const { data, loading, error, refresh } = useRtData<RequestsPayload>(
    '/api/retouche/requests',
  );
  const [selected, setSelected] = useState<RtRequestDTO | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <Stack spacing={3}>
      {loading ? <LinearProgress /> : null}
      {error ? <Alert severity="error">{error}</Alert> : null}
      {message ? <Alert severity="success">{message}</Alert> : null}

      <Typography variant="subtitle1">Demandes du Contrôle qualité</Typography>
      {(data?.requests.length ?? 0) === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Aucune demande de retouche pour le moment.
        </Typography>
      ) : (
        data?.requests.map((request) => (
          <Paper key={request.id} variant="outlined" className="p-3">
            <Stack spacing={1}>
              <Stack direction="row" spacing={1} alignItems="center" useFlexGap>
                <Typography variant="body1">
                  {request.code} — lot {request.lotCode} — {request.productNom}{' '}
                  ({request.colorNom})
                </Typography>
                <Chip
                  size="small"
                  color={
                    request.receptionId
                      ? request.status === 'acceptee'
                        ? 'success'
                        : 'primary'
                      : 'warning'
                  }
                  label={
                    request.receptionId
                      ? request.status === 'acceptee'
                        ? RT_STATUS_LABELS.acceptee
                        : 'Réceptionnée'
                      : RT_STATUS_LABELS.en_attente
                  }
                />
                {request.origin === 'final' ? (
                  <Chip size="small" variant="outlined" label="Retouche répétée" />
                ) : null}
              </Stack>
              <Typography variant="body2" color="text.secondary">
                {request.lines
                  .map((line) => `${line.sizeLabel} : ${line.receivedQty}/${line.requestedQty}`)
                  .join(' · ')}
                {request.assignedQty > 0 ? ` — affecté : ${request.assignedQty}` : ''}
                {request.processedQty > 0 ? ` — traité : ${request.processedQty}` : ''}
                {request.returnedQty > 0 ? ` — retourné : ${request.returnedQty}` : ''}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Motif : {request.reason} — par {request.requestedByName ?? '—'} —
                contrôle {request.controleCode}
              </Typography>
              {!request.receptionId && request.status === 'en_attente' ? (
                <Button
                  size="small"
                  variant="contained"
                  onClick={() => setSelected(request)}
                >
                  Réceptionner
                </Button>
              ) : null}
            </Stack>
          </Paper>
        ))
      )}

      <Typography variant="subtitle1">Réceptions enregistrées</Typography>
      {(data?.receptions.length ?? 0) === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Aucune réception enregistrée.
        </Typography>
      ) : (
        data?.receptions.map((reception) => (
          <Paper key={reception.id} variant="outlined" className="p-3">
            <Typography variant="body1">
              Demande {reception.requestCode} — reçu par{' '}
              {reception.receivedByName ?? '—'}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {reception.lines
                .map((line) => `${line.sizeLabel} : ${line.receivedQty}/${line.requestedQty}`)
                .join(' · ')}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {reception.createdAt}
              {reception.notes ? ` — ${reception.notes}` : ''}
            </Typography>
          </Paper>
        ))
      )}

      {selected ? (
        <ReceiveDialog
          request={selected}
          onClose={() => setSelected(null)}
          onDone={(text) => {
            setSelected(null);
            setMessage(text);
            void refresh();
          }}
        />
      ) : null}
    </Stack>
  );
}
