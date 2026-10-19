'use client';

import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
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
import type {
  StBalanceDTO,
  StCartonDTO,
  StMovementDTO,
  StTransferDTO,
} from '@/types/stock';
import { ST_MOVEMENT_LABELS } from '@/types/stock';
import { sendStock, useStockData } from './use-stock';

/**
 * Mouvements et stock disponible : les soldes sont recalculés depuis
 * les mouvements réels. Sorties autorisées avec motif obligatoire et
 * transferts internes de cartons entre emplacements.
 */

interface MovementsPayload {
  items: StMovementDTO[];
  balances: StBalanceDTO[];
  transfers: StTransferDTO[];
}

interface RefsPayload {
  cartons: StCartonDTO[];
  locations: Array<{ id: number; code: string; label: string; isActive: boolean }>;
}

function SortieDialog({
  balances,
  cartons,
  onClose,
  onDone,
}: {
  balances: StBalanceDTO[];
  cartons: StCartonDTO[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [balanceKey, setBalanceKey] = useState('');
  const [qty, setQty] = useState('');
  const [cartonId, setCartonId] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const selected = balances.find(
    (balance) => `${balance.lotId}-${balance.sizeId}` === balanceKey,
  );

  const submit = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await sendStock('/api/stock/movements', {
        action: 'sortie',
        lotId: selected.lotId,
        sizeId: selected.sizeId,
        qty,
        cartonId: cartonId ? Number(cartonId) : null,
        reason,
      });
      onDone('Sortie enregistrée.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur inattendue.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Sortie autorisée de pièces</DialogTitle>
      <DialogContent>
        <Stack spacing={2} className="pt-2">
          <TextField
            select
            label="Référence (lot + taille)"
            size="small"
            value={balanceKey}
            onChange={(event) => setBalanceKey(event.target.value)}
          >
            {balances.map((balance) => (
              <MenuItem
                key={`${balance.lotId}-${balance.sizeId}`}
                value={`${balance.lotId}-${balance.sizeId}`}
              >
                {balance.lotCode} — {balance.sizeLabel} ({balance.inStock} dispo.)
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label={`Quantité${selected ? ` (max ${selected.inStock})` : ''}`}
            size="small"
            type="number"
            inputProps={{ min: 1, max: selected?.inStock ?? 0, step: 'any' }}
            value={qty}
            onChange={(event) => setQty(event.target.value)}
          />
          <TextField
            select
            label="Carton concerné (facultatif)"
            size="small"
            value={cartonId}
            onChange={(event) => setCartonId(event.target.value)}
          >
            <MenuItem value="">— aucun —</MenuItem>
            {cartons
              .filter((carton) => carton.status === 'cloture' || carton.status === 'partiellement_sorti')
              .map((carton) => (
                <MenuItem key={carton.id} value={String(carton.id)}>
                  {carton.code}
                </MenuItem>
              ))}
          </TextField>
          <TextField
            label="Motif de la sortie (obligatoire)"
            size="small"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          {error ? <Alert severity="error">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annuler</Button>
        <Button
          variant="contained"
          onClick={submit}
          disabled={busy || !selected || !reason.trim()}
        >
          Enregistrer la sortie
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function TransferDialog({
  cartons,
  locations,
  onClose,
  onDone,
}: {
  cartons: StCartonDTO[];
  locations: Array<{ id: number; code: string; label: string; isActive: boolean }>;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const movable = cartons.filter((carton) => carton.status === 'cloture');
  const activeLocations = locations.filter((location) => location.isActive);
  const [cartonId, setCartonId] = useState('');
  const [toLocationId, setToLocationId] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selected = movable.find((carton) => String(carton.id) === cartonId);
  const destinations = activeLocations.filter(
    (location) => location.id !== selected?.locationId,
  );

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await sendStock('/api/stock/movements', {
        action: 'transfer',
        cartonId: Number(cartonId),
        toLocationId: Number(toLocationId),
        reason: reason || null,
      });
      onDone('Transfert enregistré.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur inattendue.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Transfert d’un carton vers un autre emplacement</DialogTitle>
      <DialogContent>
        <Stack spacing={2} className="pt-2">
          <TextField
            select
            label="Carton clôturé"
            size="small"
            value={cartonId}
            onChange={(event) => setCartonId(event.target.value)}
          >
            {movable.map((carton) => (
              <MenuItem key={carton.id} value={String(carton.id)}>
                {carton.code} ({carton.locationCode ?? 'sans emplacement'})
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Emplacement de destination"
            size="small"
            value={toLocationId}
            onChange={(event) => setToLocationId(event.target.value)}
          >
            {destinations.map((location) => (
              <MenuItem key={location.id} value={String(location.id)}>
                {location.code} — {location.label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Motif (facultatif)"
            size="small"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          {error ? <Alert severity="error">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annuler</Button>
        <Button
          variant="contained"
          onClick={submit}
          disabled={busy || !cartonId || !toLocationId}
        >
          Confirmer le transfert
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default function MovementsManager() {
  const { data, loading, error, refresh } = useStockData<MovementsPayload>(
    '/api/stock/movements',
  );
  const { data: refs } = useStockData<RefsPayload>('/api/stock/references');
  const [dialog, setDialog] = useState<'sortie' | 'transfer' | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <Stack spacing={3}>
      {loading ? <LinearProgress /> : null}
      {error ? <Alert severity="error">{error}</Alert> : null}
      {message ? <Alert severity="success">{message}</Alert> : null}

      <Stack direction="row" spacing={2} alignItems="center" useFlexGap>
        <Typography variant="subtitle1">Stock disponible</Typography>
        <Button size="small" variant="contained" onClick={() => setDialog('sortie')}>
          Sortie autorisée
        </Button>
        <Button size="small" variant="contained" onClick={() => setDialog('transfer')}>
          Transférer un carton
        </Button>
      </Stack>
      {(data?.balances.length ?? 0) === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Aucun stock disponible.
        </Typography>
      ) : (
        data?.balances.map((balance) => (
          <Paper key={`${balance.lotId}-${balance.sizeId}`} variant="outlined" className="p-2">
            <Typography variant="body2">
              {balance.lotCode} — {balance.productNom} ({balance.colorNom}) —
              taille {balance.sizeLabel} : <strong>{balance.inStock}</strong> pièce(s)
            </Typography>
          </Paper>
        ))
      )}

      <Typography variant="subtitle1">Transferts internes</Typography>
      {(data?.transfers.length ?? 0) === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Aucun transfert enregistré.
        </Typography>
      ) : (
        data?.transfers.map((transfer) => (
          <Typography key={transfer.id} variant="body2" color="text.secondary">
            {transfer.code} — carton {transfer.cartonCode} :{' '}
            {transfer.fromCode ?? '—'} → {transfer.toCode} —{' '}
            {transfer.performedByName ?? '—'} — {transfer.confirmedAt}
          </Typography>
        ))
      )}

      <Typography variant="subtitle1">Mouvements récents</Typography>
      {(data?.items.length ?? 0) === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Aucun mouvement enregistré.
        </Typography>
      ) : (
        data?.items.map((movement) => (
          <Paper key={movement.id} variant="outlined" className="p-2">
            <Typography variant="body2">
              {ST_MOVEMENT_LABELS[movement.movementType]} — lot {movement.lotCode} —
              taille {movement.sizeLabel} — {movement.qty} pièce(s)
              {movement.cartonCode ? ` — carton ${movement.cartonCode}` : ''}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {movement.createdAt} — {movement.userName ?? '—'}
              {movement.reason ? ` — motif : ${movement.reason}` : ''}
            </Typography>
          </Paper>
        ))
      )}

      {dialog === 'sortie' ? (
        <SortieDialog
          balances={data?.balances ?? []}
          cartons={refs?.cartons ?? []}
          onClose={() => setDialog(null)}
          onDone={(text) => {
            setDialog(null);
            setMessage(text);
            void refresh();
          }}
        />
      ) : null}
      {dialog === 'transfer' ? (
        <TransferDialog
          cartons={refs?.cartons ?? []}
          locations={refs?.locations ?? []}
          onClose={() => setDialog(null)}
          onDone={(text) => {
            setDialog(null);
            setMessage(text);
            void refresh();
          }}
        />
      ) : null}
    </Stack>
  );
}
