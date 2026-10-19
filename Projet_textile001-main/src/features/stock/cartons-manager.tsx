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
import type {
  StCartonDTO,
  StLocationDTO,
} from '@/types/stock';
import { ST_CARTON_STATUS_LABELS } from '@/types/stock';
import { sendStock, useStockData } from './use-stock';

/**
 * Cartons et emplacements : création, clôture, réouverture autorisée,
 * annulation contrôlée, réimpression d'étiquette, gestion des
 * emplacements de rangement configurables.
 */

const CARTON_COLORS: Record<string, 'default' | 'primary' | 'success' | 'warning' | 'error'> = {
  remplissage: 'primary',
  cloture: 'success',
  bloque: 'error',
  partiellement_sorti: 'warning',
  vide: 'default',
  annule: 'default',
};

interface RefsPayload {
  cartons: StCartonDTO[];
  locations: StLocationDTO[];
}

function CartonDialog({
  carton,
  locations,
  mode,
  onClose,
  onDone,
}: {
  carton: StCartonDTO | null;
  locations: StLocationDTO[];
  mode: 'create' | 'close' | 'reopen' | 'cancel';
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const activeLocations = locations.filter((location) => location.isActive);
  const [code, setCode] = useState('');
  const [locationId, setLocationId] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const titles: Record<typeof mode, string> = {
    create: 'Créer un carton',
    close: `Clôturer le carton ${carton?.code ?? ''}`,
    reopen: `Rouvrir le carton ${carton?.code ?? ''}`,
    cancel: `Annuler le carton ${carton?.code ?? ''}`,
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'create') {
        await sendStock('/api/stock/cartons', {
          action: 'create',
          code: code || null,
        });
        onDone('Carton créé.');
      } else if (mode === 'close' && carton) {
        await sendStock('/api/stock/cartons', {
          action: 'close',
          cartonId: carton.id,
          locationId: Number(locationId),
        });
        onDone(`Carton ${carton.code} clôturé.`);
      } else if (mode === 'reopen' && carton) {
        await sendStock('/api/stock/cartons', {
          action: 'reopen',
          cartonId: carton.id,
          reason,
        });
        onDone(`Carton ${carton.code} rouvert.`);
      } else if (carton) {
        await sendStock('/api/stock/cartons', {
          action: 'cancel',
          cartonId: carton.id,
          reason,
        });
        onDone(`Carton ${carton.code} annulé.`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur inattendue.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{titles[mode]}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} className="pt-2">
          {mode === 'create' ? (
            <TextField
              label="Code manuel (facultatif — sinon généré)"
              size="small"
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
          ) : null}
          {mode === 'close' ? (
            <TextField
              select
              label="Emplacement de rangement"
              size="small"
              value={locationId}
              onChange={(event) => setLocationId(event.target.value)}
            >
              {activeLocations.map((location) => (
                <MenuItem key={location.id} value={String(location.id)}>
                  {location.code} — {location.label} ({location.area})
                </MenuItem>
              ))}
            </TextField>
          ) : null}
          {mode === 'reopen' || mode === 'cancel' ? (
            <TextField
              label="Motif obligatoire"
              size="small"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          ) : null}
          {error ? <Alert severity="error">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annuler</Button>
        <Button variant="contained" onClick={submit} disabled={busy}>
          Confirmer
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default function CartonsManager() {
  const { data, loading, error, refresh } = useStockData<RefsPayload>(
    '/api/stock/references',
  );
  const [dialog, setDialog] = useState<{
    mode: 'create' | 'close' | 'reopen' | 'cancel';
    carton: StCartonDTO | null;
  } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [reprintError, setReprintError] = useState<string | null>(null);

  const reprint = async (carton: StCartonDTO) => {
    try {
      await sendStock('/api/stock/cartons', {
        action: 'reprint',
        cartonId: carton.id,
      });
      setReprintError(null);
      setMessage(`Étiquette du carton ${carton.code} réimprimée (référence inchangée).`);
    } catch (cause) {
      setMessage(null);
      setReprintError(cause instanceof Error ? cause.message : 'Erreur inattendue.');
    }
  };

  return (
    <Stack spacing={3}>
      {loading ? <LinearProgress /> : null}
      {error ? <Alert severity="error">{error}</Alert> : null}
      {reprintError ? <Alert severity="error">{reprintError}</Alert> : null}
      {message ? <Alert severity="success">{message}</Alert> : null}

      <Stack direction="row" spacing={2} alignItems="center" useFlexGap>
        <Typography variant="subtitle1">Cartons</Typography>
        <Button
          size="small"
          variant="contained"
          onClick={() => setDialog({ mode: 'create', carton: null })}
        >
          Nouveau carton
        </Button>
      </Stack>

      {(data?.cartons.length ?? 0) === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Aucun carton. Créez-en un puis réceptionnez les transferts CQ.
        </Typography>
      ) : (
        data?.cartons.map((carton) => (
          <Paper key={carton.id} variant="outlined" className="p-3">
            <Stack spacing={1}>
              <Stack direction="row" spacing={1} alignItems="center" useFlexGap>
                <Typography variant="body1">{carton.code}</Typography>
                <Chip
                  size="small"
                  color={CARTON_COLORS[carton.status] ?? 'default'}
                  label={ST_CARTON_STATUS_LABELS[carton.status]}
                />
                <Typography variant="body2" color="text.secondary">
                  {carton.totalQty} pièce(s) —{' '}
                  {carton.locationLabel
                    ? `${carton.locationCode} (${carton.locationLabel})`
                    : 'sans emplacement'}
                </Typography>
              </Stack>
              <Typography variant="body2" color="text.secondary">
                {carton.lines
                  .map(
                    (line) =>
                      `lot ${line.lotCode} · CQ ${line.controleCode} · ${line.sizeLabel} : ${line.qty}`,
                  )
                  .join(' — ') || 'Carton vide'}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Créé le {carton.createdAt} par {carton.createdByName ?? '—'}
                {carton.closedAt ? ` — clôturé le ${carton.closedAt}` : ''} — QR :{' '}
                {carton.identifier?.qrPayload ?? '—'}
              </Typography>
              <Stack direction="row" spacing={1} useFlexGap>
                {carton.status === 'remplissage' ? (
                  <Button
                    size="small"
                    variant="contained"
                    onClick={() => setDialog({ mode: 'close', carton })}
                  >
                    Clôturer
                  </Button>
                ) : null}
                {carton.status === 'cloture' || carton.status === 'bloque' ? (
                  <Button
                    size="small"
                    onClick={() => setDialog({ mode: 'reopen', carton })}
                  >
                    Rouvrir (motif)
                  </Button>
                ) : null}
                {carton.status === 'remplissage' || carton.status === 'vide' ? (
                  <Button
                    size="small"
                    color="error"
                    onClick={() => setDialog({ mode: 'cancel', carton })}
                  >
                    Annuler le carton
                  </Button>
                ) : null}
                {carton.identifier ? (
                  <Button size="small" onClick={() => void reprint(carton)}>
                    Réimprimer l’étiquette
                  </Button>
                ) : null}
              </Stack>
            </Stack>
          </Paper>
        ))
      )}

      <Typography variant="subtitle1">Emplacements de rangement</Typography>
      {(data?.locations.length ?? 0) === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Aucun emplacement créé.
        </Typography>
      ) : (
        data?.locations.map((location) => (
          <Paper key={location.id} variant="outlined" className="p-3">
            <Stack direction="row" spacing={1} alignItems="center" useFlexGap>
              <Typography variant="body1">
                {location.code} — {location.label}
              </Typography>
              <Chip size="small" variant="outlined" label={location.area} />
              <Chip
                size="small"
                color={location.isActive ? 'success' : 'default'}
                label={location.isActive ? 'Actif' : 'Inactif'}
              />
              <Typography variant="body2" color="text.secondary">
                {location.cartonsCount} carton(s)
              </Typography>
              <Button
                size="small"
                onClick={async () => {
                  try {
                    await sendStock('/api/stock/locations', {
                      action: 'toggle',
                      locationId: location.id,
                    });
                    void refresh();
                  } catch (cause) {
                    setReprintError(
                      cause instanceof Error ? cause.message : 'Erreur inattendue.',
                    );
                  }
                }}
              >
                {location.isActive ? 'Désactiver' : 'Activer'}
              </Button>
            </Stack>
          </Paper>
        ))
      )}
      <LocationCreator onDone={(text) => setMessage(text)} />

      {dialog ? (
        <CartonDialog
          mode={dialog.mode}
          carton={dialog.carton}
          locations={data?.locations ?? []}
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

function LocationCreator({ onDone }: { onDone: (message: string) => void }) {
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [area, setArea] = useState('emplacement');
  const [error, setError] = useState<string | null>(null);

  return (
    <Paper variant="outlined" className="p-3">
      <Stack spacing={2}>
        <Typography variant="body2">Créer un emplacement</Typography>
        <Stack direction="row" spacing={1} useFlexGap>
          <TextField
            label="Code"
            size="small"
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
          <TextField
            label="Libellé"
            size="small"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
          <TextField
            select
            label="Type"
            size="small"
            value={area}
            onChange={(event) => setArea(event.target.value)}
          >
            {['zone', 'salle', 'rangee', 'etagere', 'niveau', 'emplacement'].map(
              (value) => (
                <MenuItem key={value} value={value}>
                  {value}
                </MenuItem>
              ),
            )}
          </TextField>
          <Button
            variant="contained"
            onClick={async () => {
              setError(null);
              try {
                await sendStock('/api/stock/locations', { code, label, area });
                setCode('');
                setLabel('');
                onDone(`Emplacement ${code.toUpperCase()} créé.`);
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : 'Erreur inattendue.');
              }
            }}
          >
            Créer
          </Button>
        </Stack>
        {error ? <Alert severity="error">{error}</Alert> : null}
      </Stack>
    </Paper>
  );
}
