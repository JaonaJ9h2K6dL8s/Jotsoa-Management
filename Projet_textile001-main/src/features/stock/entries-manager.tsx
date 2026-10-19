'use client';

import { useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { StCartonDTO, StEntryDTO, StPendingCqTransferDTO } from '@/types/stock';
import { sendStock, useStockData } from './use-stock';

/**
 * Entrées de vêtements finis : réception des transferts conformes du
 * Contrôle qualité dans des cartons ouverts. Aucune saisie libre de
 * quantité : la quantité rangée = la quantité transférée par le CQ.
 */

interface EntriesPayload {
  pendingTransfers: StPendingCqTransferDTO[];
  items: StEntryDTO[];
}

interface RefsPayload {
  cartons: StCartonDTO[];
}

function ReceiveDialog({
  transfer,
  cartons,
  onClose,
  onDone,
}: {
  transfer: StPendingCqTransferDTO;
  cartons: StCartonDTO[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const openCartons = cartons.filter((carton) => carton.status === 'remplissage');
  const [bySize, setBySize] = useState<Record<number, string>>({});
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await sendStock('/api/stock/entries', {
        transferId: transfer.transferId,
        notes: notes || null,
        lines: transfer.lines.map((line) => ({
          sizeId: line.sizeId,
          cartonId: Number(bySize[line.sizeId] ?? 0),
        })),
      });
      onDone(`Transfert ${transfer.transferCode} réceptionné en stock.`);
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
            {transfer.productNom} — {transfer.colorNom}. Contrôle{' '}
            {transfer.controleCode}. Chaque taille doit être rangée dans un
            carton ouvert (même carton possible pour plusieurs tailles).
          </Typography>
          {openCartons.length === 0 ? (
            <Alert severity="warning">
              Aucun carton ouvert : créez d’abord un carton dans « Cartons et
              emplacements ».
            </Alert>
          ) : null}
          {transfer.lines.map((line) => (
            <TextField
              key={line.sizeId}
              select
              label={`Carton pour la taille ${line.sizeLabel} (${line.qty} pièce(s))`}
              size="small"
              value={bySize[line.sizeId] ?? ''}
              onChange={(event) =>
                setBySize((prev) => ({ ...prev, [line.sizeId]: event.target.value }))
              }
            >
              {openCartons.map((carton) => (
                <MenuItem key={carton.id} value={String(carton.id)}>
                  {carton.code} — {carton.locationLabel ?? 'sans emplacement'}
                </MenuItem>
              ))}
            </TextField>
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
        <Button
          variant="contained"
          onClick={submit}
          disabled={busy || openCartons.length === 0}
        >
          Confirmer la réception
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default function EntriesManager() {
  const { data, loading, error, refresh } = useStockData<EntriesPayload>(
    '/api/stock/entries',
  );
  const { data: refs } = useStockData<RefsPayload>('/api/stock/references');
  const cartons = useMemo(() => refs?.cartons ?? [], [refs]);
  const [selected, setSelected] = useState<StPendingCqTransferDTO | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <Stack spacing={3}>
      {loading ? <LinearProgress /> : null}
      {error ? <Alert severity="error">{error}</Alert> : null}
      {message ? <Alert severity="success">{message}</Alert> : null}

      <Typography variant="subtitle1">
        Transferts conformes du Contrôle qualité à réceptionner
      </Typography>
      {(data?.pendingTransfers.length ?? 0) === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Aucun transfert CQ en attente de réception.
        </Typography>
      ) : (
        data?.pendingTransfers.map((transfer) => (
          <Paper key={transfer.transferId} variant="outlined" className="p-3">
            <Stack spacing={1}>
              <Stack direction="row" spacing={1} alignItems="center" useFlexGap>
                <Typography variant="body1">
                  {transfer.transferCode} — lot {transfer.lotCode} —{' '}
                  {transfer.productNom} ({transfer.colorNom})
                </Typography>
                <Chip size="small" color="warning" label="À réceptionner" />
              </Stack>
              <Typography variant="body2" color="text.secondary">
                {transfer.lines
                  .map((line) => `${line.sizeLabel} : ${line.qty}`)
                  .join(' · ')}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Contrôle {transfer.controleCode} — confirmé le{' '}
                {transfer.confirmedAt}
              </Typography>
              <Button
                size="small"
                variant="contained"
                onClick={() => setSelected(transfer)}
              >
                Réceptionner en stock
              </Button>
            </Stack>
          </Paper>
        ))
      )}

      <Typography variant="subtitle1">Entrées enregistrées</Typography>
      {(data?.items.length ?? 0) === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Aucune entrée enregistrée.
        </Typography>
      ) : (
        data?.items.map((entry) => (
          <Paper key={entry.id} variant="outlined" className="p-3">
            <Typography variant="body1">
              {entry.code} — transfert {entry.transferCode} — lot {entry.lotCode}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {entry.lines
                .map(
                  (line) =>
                    `${line.sizeLabel} : ${line.qty} → carton ${line.cartonCode}`,
                )
                .join(' · ')}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Contrôle {entry.controleCode} — reçu par{' '}
              {entry.receivedByName ?? '—'} — {entry.createdAt}
            </Typography>
          </Paper>
        ))
      )}

      {selected ? (
        <ReceiveDialog
          transfer={selected}
          cartons={cartons}
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
