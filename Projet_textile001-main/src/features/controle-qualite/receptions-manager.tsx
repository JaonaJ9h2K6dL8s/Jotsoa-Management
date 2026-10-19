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
import type { CqReceptionDTO, PendingCqTransferDTO } from '@/types/cq';
import { sendCq, useCqData } from './use-cq';

/**
 * Réception des transferts confirmés par la couture. La quantité
 * reçue est saisie par taille ; tout écart est alerté et la réception
 * partielle reste bloquée jusqu'à résolution.
 */

interface ReceptionsPayload {
  pending: PendingCqTransferDTO[];
  receptions: CqReceptionDTO[];
}

function ReceiveDialog({
  transfer,
  onClose,
  onDone,
}: {
  transfer: PendingCqTransferDTO;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [received, setReceived] = useState<Record<number, string>>(
    Object.fromEntries(transfer.lines.map((line) => [line.sizeId, String(line.qty)])),
  );
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await sendCq('/api/controle-qualite/receptions', 'POST', {
        transferId: transfer.transferId,
        notes: notes || null,
        lines: transfer.lines.map((line) => ({
          sizeId: line.sizeId,
          receivedQty: received[line.sizeId] ?? '0',
        })),
      });
      onDone(`Réception du transfert ${transfer.transferCode} enregistrée.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur inattendue.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        Réception du transfert {transfer.transferCode} — lot {transfer.lotCode}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} className="pt-2">
          <Typography variant="body2" color="text.secondary">
            {transfer.productNom} — {transfer.colorNom}. Une quantité non
            reçue crée une réception partielle explicite, alertée et bloquée.
          </Typography>
          {transfer.lines.map((line) => (
            <TextField
              key={line.sizeId}
              label={`Quantité reçue — taille ${line.sizeLabel} (transféré : ${line.qty})`}
              type="number"
              size="small"
              value={received[line.sizeId] ?? '0'}
              inputProps={{ min: 0, max: line.qty, step: 'any' }}
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

export default function ReceptionsCqManager() {
  const { data, loading, error, refresh } = useCqData<ReceptionsPayload>(
    '/api/controle-qualite/receptions',
  );
  const [selected, setSelected] = useState<PendingCqTransferDTO | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <Stack spacing={3}>
      {loading ? <LinearProgress /> : null}
      {error ? <Alert severity="error">{error}</Alert> : null}
      {message ? <Alert severity="success">{message}</Alert> : null}

      <Stack spacing={1}>
        <Typography variant="subtitle1">Transferts couture à réceptionner</Typography>
        {(data?.pending.length ?? 0) === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Aucun transfert confirmé en attente de réception.
          </Typography>
        ) : (
          data?.pending.map((transfer) => (
            <Paper key={transfer.transferId} variant="outlined" className="p-3">
              <Stack
                direction="row"
                alignItems="center"
                justifyContent="space-between"
                useFlexGap
              >
                <Stack>
                  <Typography variant="body1">
                    {transfer.transferCode} — lot {transfer.lotCode}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {transfer.productNom} — {transfer.colorNom} —{' '}
                    {transfer.roomNom || '—'} / {transfer.lineNom || '—'}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {transfer.lines
                      .map((line) => `${line.sizeLabel} : ${line.qty}`)
                      .join(', ')}
                  </Typography>
                </Stack>
                <Button variant="contained" onClick={() => setSelected(transfer)}>
                  Réceptionner
                </Button>
              </Stack>
            </Paper>
          ))
        )}
      </Stack>

      <Stack spacing={1}>
        <Typography variant="subtitle1">Réceptions enregistrées</Typography>
        {(data?.receptions.length ?? 0) === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Aucune réception enregistrée.
          </Typography>
        ) : (
          data?.receptions.map((reception) => (
            <Paper key={reception.id} variant="outlined" className="p-3">
              <Stack direction="row" spacing={1} alignItems="center" useFlexGap>
                <Typography variant="body1">
                  {reception.code} — transfert {reception.transferCode} — lot{' '}
                  {reception.lotCode}
                </Typography>
                <Chip
                  size="small"
                  color={reception.status === 'complete' ? 'success' : 'warning'}
                  label={reception.status === 'complete' ? 'Complète' : 'Partielle'}
                />
              </Stack>
              <Typography variant="body2" color="text.secondary">
                {reception.lines
                  .map(
                    (line) =>
                      `${line.sizeLabel} : ${line.receivedQty}/${line.transferredQty}`,
                  )
                  .join(' · ')}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Reçu par {reception.receivedByName ?? '—'} le{' '}
                {reception.receivedAt}
                {reception.notes ? ` — ${reception.notes}` : ''}
              </Typography>
            </Paper>
          ))
        )}
      </Stack>

      {selected ? (
        <ReceiveDialog
          transfer={selected}
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
