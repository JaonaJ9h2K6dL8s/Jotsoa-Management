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
import type { StInventoryDTO, StLocationDTO } from '@/types/stock';
import { ST_INVENTORY_STATUS_LABELS } from '@/types/stock';
import { sendStock, useStockData } from './use-stock';

/**
 * Inventaires physiques : comptage par carton et taille, détection
 * des écarts, soumission d'ajustements à seconde validation. Le
 * comptage ne modifie jamais le stock directement.
 */

interface InventoriesPayload {
  items: StInventoryDTO[];
}

interface RefsPayload {
  locations: StLocationDTO[];
}

function CountDialog({
  inventory,
  onClose,
  onDone,
}: {
  inventory: StInventoryDTO;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [observations, setObservations] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await sendStock('/api/stock/inventories', {
        action: 'count',
        inventoryId: inventory.id,
        lines: inventory.lines
          .filter((line) => counts[line.id] !== undefined && counts[line.id] !== '')
          .map((line) => ({
            lineId: line.id,
            countedQty: counts[line.id],
            observation: observations[line.id] || null,
          })),
      });
      onDone(`Comptage enregistré pour ${inventory.code}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur inattendue.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Comptage — session {inventory.code}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} className="pt-2">
          {inventory.lines.map((line) => (
            <Stack key={line.id} direction="row" spacing={1} useFlexGap>
              <TextField
                label={`${line.cartonCode} · ${line.lotCode} · ${line.sizeLabel} (théo. ${line.theoreticalQty})`}
                size="small"
                type="number"
                inputProps={{ min: 0, step: 'any' }}
                value={counts[line.id] ?? ''}
                onChange={(event) =>
                  setCounts((prev) => ({ ...prev, [line.id]: event.target.value }))
                }
              />
              <TextField
                label="Observation"
                size="small"
                value={observations[line.id] ?? ''}
                onChange={(event) =>
                  setObservations((prev) => ({ ...prev, [line.id]: event.target.value }))
                }
              />
            </Stack>
          ))}
          {error ? <Alert severity="error">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annuler</Button>
        <Button variant="contained" onClick={submit} disabled={busy}>
          Enregistrer le comptage
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function GapsDialog({
  inventory,
  onClose,
  onDone,
}: {
  inventory: StInventoryDTO;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const gaps = inventory.lines.filter(
    (line) => line.countedQty !== null && line.countedQty !== line.theoreticalQty,
  );

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await sendStock('/api/stock/inventories', {
        action: 'submitAdjustments',
        inventoryId: inventory.id,
        items: gaps.map((line) => ({
          lineId: line.id,
          reason: reasons[line.id] ?? '',
        })),
      });
      onDone(
        `Écarts de ${inventory.code} soumis à seconde validation (stock non modifié).`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur inattendue.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Écarts détectés — session {inventory.code}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} className="pt-2">
          {gaps.map((line) => {
            const delta = (line.countedQty ?? 0) - line.theoreticalQty;
            return (
              <Stack key={line.id} spacing={1}>
                <Typography variant="body2">
                  {line.cartonCode} · lot {line.lotCode} · {line.sizeLabel} : théo.{' '}
                  {line.theoreticalQty} — compté {line.countedQty} (
                  {delta > 0 ? '+' : ''}
                  {delta})
                </Typography>
                <TextField
                  label="Motif de l'ajustement (obligatoire)"
                  size="small"
                  value={reasons[line.id] ?? ''}
                  onChange={(event) =>
                    setReasons((prev) => ({ ...prev, [line.id]: event.target.value }))
                  }
                />
              </Stack>
            );
          })}
          <Alert severity="info">
            Les ajustements ne prendront effet qu’après approbation par un
            autre responsable de stock.
          </Alert>
          {error ? <Alert severity="error">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annuler</Button>
        <Button
          variant="contained"
          onClick={submit}
          disabled={busy || gaps.some((line) => !(reasons[line.id] ?? '').trim())}
        >
          Soumettre les ajustements
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default function InventoriesManager() {
  const { data, loading, error, refresh } = useStockData<InventoriesPayload>(
    '/api/stock/inventories',
  );
  const { data: refs } = useStockData<RefsPayload>('/api/stock/references');
  const [locationId, setLocationId] = useState('');
  const [notes, setNotes] = useState('');
  const [counting, setCounting] = useState<StInventoryDTO | null>(null);
  const [gapping, setGapping] = useState<StInventoryDTO | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  return (
    <Stack spacing={3}>
      {loading ? <LinearProgress /> : null}
      {error ? <Alert severity="error">{error}</Alert> : null}
      {message ? <Alert severity="success">{message}</Alert> : null}

      <Paper variant="outlined" className="p-3">
        <Stack spacing={2}>
          <Typography variant="subtitle1">Nouvelle session d’inventaire</Typography>
          <Stack direction="row" spacing={1} useFlexGap>
            <TextField
              select
              label="Périmètre (emplacement)"
              size="small"
              value={locationId}
              onChange={(event) => setLocationId(event.target.value)}
            >
              <MenuItem value="">Tout le stock</MenuItem>
              {(refs?.locations ?? [])
                .filter((location) => location.isActive)
                .map((location) => (
                  <MenuItem key={location.id} value={String(location.id)}>
                    {location.code} — {location.label}
                  </MenuItem>
                ))}
            </TextField>
            <TextField
              label="Observations (facultatif)"
              size="small"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
            <Button
              variant="contained"
              onClick={async () => {
                setCreateError(null);
                try {
                  await sendStock('/api/stock/inventories', {
                    action: 'create',
                    locationId: locationId ? Number(locationId) : null,
                    notes: notes || null,
                  });
                  setNotes('');
                  setMessage('Session d’inventaire créée (théorique figé).');
                  void refresh();
                } catch (cause) {
                  setCreateError(
                    cause instanceof Error ? cause.message : 'Erreur inattendue.',
                  );
                }
              }}
            >
              Créer la session
            </Button>
          </Stack>
          {createError ? <Alert severity="error">{createError}</Alert> : null}
        </Stack>
      </Paper>

      {(data?.items.length ?? 0) === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Aucune session d’inventaire.
        </Typography>
      ) : (
        data?.items.map((inventory) => (
          <Paper key={inventory.id} variant="outlined" className="p-3">
            <Stack spacing={1}>
              <Stack direction="row" spacing={1} alignItems="center" useFlexGap>
                <Typography variant="body1">{inventory.code}</Typography>
                <Chip
                  size="small"
                  color={inventory.gapsCount > 0 ? 'warning' : 'default'}
                  label={ST_INVENTORY_STATUS_LABELS[inventory.status]}
                />
                <Typography variant="body2" color="text.secondary">
                  {inventory.locationCode ?? 'tout le stock'} —{' '}
                  {inventory.gapsCount} écart(s)
                </Typography>
              </Stack>
              <Typography variant="caption" color="text.secondary">
                {inventory.lines.length} ligne(s) — créée le {inventory.createdAt} par{' '}
                {inventory.createdByName ?? '—'}
                {inventory.countedAt ? ` — comptée le ${inventory.countedAt}` : ''}
              </Typography>
              {inventory.status === 'comptage' || inventory.status === 'ecarts' ? (
                <Stack direction="row" spacing={1} useFlexGap>
                  <Button
                    size="small"
                    variant="contained"
                    onClick={() => setCounting(inventory)}
                  >
                    Saisir le comptage
                  </Button>
                  {inventory.gapsCount > 0 ? (
                    <Button size="small" onClick={() => setGapping(inventory)}>
                      Soumettre les écarts
                    </Button>
                  ) : null}
                </Stack>
              ) : null}
            </Stack>
          </Paper>
        ))
      )}

      {counting ? (
        <CountDialog
          inventory={counting}
          onClose={() => setCounting(null)}
          onDone={(text) => {
            setCounting(null);
            setMessage(text);
            void refresh();
          }}
        />
      ) : null}
      {gapping ? (
        <GapsDialog
          inventory={gapping}
          onClose={() => setGapping(null)}
          onDone={(text) => {
            setGapping(null);
            setMessage(text);
            void refresh();
          }}
        />
      ) : null}
    </Stack>
  );
}
