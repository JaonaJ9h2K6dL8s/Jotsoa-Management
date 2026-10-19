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
import type { AssignmentDTO, CoutureTransferDTO, LotBalanceDTO } from '@/types/couture';
import { sendCouture, useCoutureData } from './use-couture';

/**
 * Transferts des pièces cousues vers le contrôle qualité. Seules les
 * quantités réellement cousues et non transférées peuvent partir.
 * L'annulation d'un transfert confirmé est une opération sensible.
 */

function TransferDialog({
  balances,
  assignments,
  onClose,
  onDone,
}: {
  balances: LotBalanceDTO[];
  assignments: AssignmentDTO[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const usable = assignments.filter((item) =>
    ['en_cours', 'terminee'].includes(item.status),
  );
  const [assignmentId, setAssignmentId] = useState('');
  const [quantities, setQuantities] = useState<Record<number, string>>({});
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const selected = usable.find((item) => String(item.id) === assignmentId);
  const lot = balances.find((item) => item.lotId === selected?.lotId);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await sendCouture('/api/couture/transfers', 'POST', {
        assignmentId: Number(assignmentId),
        notes: notes || null,
        sizes: Object.entries(quantities)
          .filter(([, value]) => value !== '' && Number(value) > 0)
          .map(([sizeId, value]) => ({ sizeId: Number(sizeId), qty: value })),
      });
      onDone('Transfert confirmé : les pièces sont disponibles au contrôle qualité.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur inattendue.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Préparer un transfert vers le contrôle qualité</DialogTitle>
      <DialogContent>
        <Stack spacing={2} className="pt-2">
          <TextField
            select
            label="Affectation"
            value={assignmentId}
            onChange={(event) => {
              setAssignmentId(event.target.value);
              setQuantities({});
            }}
            size="small"
          >
            {usable.map((item) => (
              <MenuItem key={item.id} value={String(item.id)}>
                {item.code} — lot {item.lotCode} — {item.lineNom}
              </MenuItem>
            ))}
          </TextField>
          {selected && lot ? (
            <Typography variant="body2" color="text.secondary">
              Lot {lot.lotCode} — cousu : {lot.sewnQty} · déjà transféré :{' '}
              {lot.transferredCqQty} · disponible : {lot.availableToTransfer}
            </Typography>
          ) : null}
          {(selected?.sizes ?? []).map((size) => (
            <TextField
              key={size.sizeId}
              label={`Taille ${size.sizeLabel} — cousu : ${size.sewnQty}`}
              type="number"
              size="small"
              value={quantities[size.sizeId] ?? ''}
              inputProps={{ min: 0, step: 'any' }}
              onChange={(event) =>
                setQuantities((prev) => ({ ...prev, [size.sizeId]: event.target.value }))
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
        <Button
          variant="contained"
          onClick={submit}
          disabled={busy || !assignmentId}
        >
          Confirmer le transfert
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default function TransfersManager() {
  const balances = useCoutureData<LotBalanceDTO[]>('/api/couture/balances');
  const assignments = useCoutureData<AssignmentDTO[]>('/api/couture/assignments');
  const transfers = useCoutureData<CoutureTransferDTO[]>('/api/couture/transfers');
  const [open, setOpen] = useState(false);
  const [cancelReasons, setCancelReasons] = useState<Record<number, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const requestCancel = async (transfer: CoutureTransferDTO) => {
    setError(null);
    try {
      await sendCouture(`/api/couture/transfers/${transfer.id}`, 'PATCH', {
        reason: cancelReasons[transfer.id] ?? '',
      });
      setMessage(
        `Demande d'annulation du transfert ${transfer.code} soumise à la seconde validation.`,
      );
      void transfers.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur inattendue.');
    }
  };

  return (
    <Stack spacing={3}>
      {balances.loading || assignments.loading || transfers.loading ? <LinearProgress /> : null}
      {error ? <Alert severity="error">{error}</Alert> : null}
      {message ? <Alert severity="success">{message}</Alert> : null}
      <Stack direction="row" justifyContent="flex-end">
        <Button variant="contained" onClick={() => setOpen(true)}>
          Préparer un transfert
        </Button>
      </Stack>

      {(transfers.data ?? []).length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Aucun transfert vers le contrôle qualité.
        </Typography>
      ) : (
        (transfers.data ?? []).map((transfer) => (
          <Paper key={transfer.id} variant="outlined" className="p-3">
            <Stack spacing={1}>
              <Stack direction="row" spacing={1} alignItems="center" useFlexGap>
                <Typography variant="body1">{transfer.code}</Typography>
                <Chip
                  size="small"
                  color={transfer.status === 'confirme' ? 'success' : 'default'}
                  label={transfer.status === 'confirme' ? 'Confirmé' : 'Annulé'}
                />
                <Typography variant="body2" color="text.secondary">
                  lot {transfer.lotCode} — {transfer.productNom} — {transfer.colorNom} —
                  affectation {transfer.assignmentCode}
                </Typography>
              </Stack>
              <Typography variant="body2" color="text.secondary">
                {transfer.lines
                  .map((line) => `${line.sizeLabel} : ${line.qty}`)
                  .join(' · ')}
              </Typography>
              {transfer.status === 'confirme' ? (
                <Stack direction="row" spacing={1} alignItems="center" useFlexGap>
                  <TextField
                    label="Motif d'annulation"
                    size="small"
                    value={cancelReasons[transfer.id] ?? ''}
                    onChange={(event) =>
                      setCancelReasons((prev) => ({ ...prev, [transfer.id]: event.target.value }))
                    }
                  />
                  <Button
                    size="small"
                    color="error"
                    onClick={() => requestCancel(transfer)}
                    disabled={!(cancelReasons[transfer.id] ?? '').trim()}
                  >
                    Demander l’annulation
                  </Button>
                </Stack>
              ) : null}
            </Stack>
          </Paper>
        ))
      )}

      {open ? (
        <TransferDialog
          balances={balances.data ?? []}
          assignments={assignments.data ?? []}
          onClose={() => setOpen(false)}
          onDone={(text) => {
            setOpen(false);
            setMessage(text);
            void transfers.refresh();
            void balances.refresh();
          }}
        />
      ) : null}
    </Stack>
  );
}
