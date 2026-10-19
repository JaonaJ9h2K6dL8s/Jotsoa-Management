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
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { CqLotBalanceDTO, StockTransferDTO } from '@/types/cq';
import { sendCq, useCqData } from './use-cq';

/**
 * Préparation des transferts vers le stock : seules les quantités
 * conformes, disponibles et issues d'un contrôle validé partent. Les
 * pièces à retoucher, rebutées ou en attente ne partent jamais.
 */

function TransferDialog({
  balances,
  onClose,
  onDone,
}: {
  balances: CqLotBalanceDTO[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const eligible = balances.filter(
    (lot) =>
      lot.controleStatus === 'valide' &&
      lot.sizes.some((size) => size.availableStock > 0),
  );
  const [lotId, setLotId] = useState('');
  const [qty, setQty] = useState<Record<number, string>>({});
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const lot = eligible.find((item) => String(item.lotId) === lotId);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await sendCq('/api/controle-qualite/stock-transfers', 'POST', {
        // Le contrôle validé est résolu côté serveur à partir du lot.
        lotId: lot?.lotId,
        lines:
          lot?.sizes
            .filter((size) => Number(qty[size.sizeId] ?? '0') > 0)
            .map((size) => ({
              sizeId: size.sizeId,
              qty: qty[size.sizeId] ?? '0',
            })) ?? [],
        notes: notes || null,
      });
      onDone('Transfert vers le stock enregistré.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur inattendue.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Transfert vers le stock</DialogTitle>
      <DialogContent>
        <Stack spacing={2} className="pt-2">
          {eligible.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              Aucun lot éligible : il faut un contrôle validé avec des
              quantités conformes non encore transférées.
            </Typography>
          ) : (
            <>
              <TextField
                select
                label="Lot à transférer"
                size="small"
                value={lotId}
                onChange={(event) => {
                  setLotId(event.target.value);
                  setQty({});
                }}
              >
                {eligible.map((item) => (
                  <MenuItem key={item.lotId} value={String(item.lotId)}>
                    {item.lotCode} — contrôle {item.controleCode}
                  </MenuItem>
                ))}
              </TextField>
              {lot
                ? lot.sizes
                    .filter((size) => size.availableStock > 0)
                    .map((size) => (
                      <TextField
                        key={size.sizeId}
                        label={`Quantité — ${size.sizeLabel} (disponible : ${size.availableStock})`}
                        type="number"
                        size="small"
                        value={qty[size.sizeId] ?? ''}
                        inputProps={{
                          min: 0,
                          max: size.availableStock,
                          step: 'any',
                        }}
                        onChange={(event) =>
                          setQty((prev) => ({
                            ...prev,
                            [size.sizeId]: event.target.value,
                          }))
                        }
                      />
                    ))
                : null}
              <TextField
                label="Observations (facultatif)"
                size="small"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </>
          )}
          {error ? <Alert severity="error">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annuler</Button>
        <Button
          variant="contained"
          onClick={submit}
          disabled={busy || !lotId}
        >
          Préparer le transfert
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default function StockTransfersManager() {
  const balances = useCqData<CqLotBalanceDTO[]>(
    '/api/controle-qualite/balances',
  );
  const transfers = useCqData<StockTransferDTO[]>(
    '/api/controle-qualite/stock-transfers',
  );
  const [message, setMessage] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const done = (text: string) => {
    setOpen(false);
    setMessage(text);
    void balances.refresh();
    void transfers.refresh();
  };

  return (
    <Stack spacing={3}>
      {balances.loading || transfers.loading ? <LinearProgress /> : null}
      {balances.error ? <Alert severity="error">{balances.error}</Alert> : null}
      {transfers.error ? <Alert severity="error">{transfers.error}</Alert> : null}
      {message ? <Alert severity="success">{message}</Alert> : null}

      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="subtitle1">Transferts vers le stock</Typography>
        <Button variant="contained" onClick={() => setOpen(true)}>
          Préparer un transfert
        </Button>
      </Stack>

      {(transfers.data?.length ?? 0) === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Aucun transfert vers le stock enregistré.
        </Typography>
      ) : (
        transfers.data?.map((transfer) => (
          <Paper key={transfer.id} variant="outlined" className="p-3">
            <Stack direction="row" spacing={1} alignItems="center" useFlexGap>
              <Typography variant="body1">
                {transfer.code} — lot {transfer.lotCode} — contrôle{' '}
                {transfer.controleCode}
              </Typography>
              <Chip
                size="small"
                color={transfer.status === 'confirme' ? 'success' : 'default'}
                label={transfer.status === 'confirme' ? 'Confirmé' : 'Annulé'}
              />
            </Stack>
            <Typography variant="body2" color="text.secondary">
              {transfer.lines
                .map((line) => `${line.sizeLabel} : ${line.qty}`)
                .join(' · ')}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Préparé par {transfer.preparedByName ?? '—'} le{' '}
              {transfer.confirmedAt}
              {transfer.notes ? ` — ${transfer.notes}` : ''}
            </Typography>
          </Paper>
        ))
      )}

      {open && balances.data ? (
        <TransferDialog
          balances={balances.data}
          onClose={() => setOpen(false)}
          onDone={done}
        />
      ) : null}
    </Stack>
  );
}
