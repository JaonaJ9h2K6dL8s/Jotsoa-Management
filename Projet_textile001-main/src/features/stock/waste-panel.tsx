'use client';

import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { StWasteMovementDTO, StWasteStockDTO } from '@/types/stock';
import { sendStock, useStockData } from './use-stock';

/**
 * Déchets textiles : stock distinct des vêtements finis, exprimé en
 * kg (unité d'origine de la Coupe, jamais mélangée aux pièces).
 * Sorties et ajustements avec motif obligatoire.
 */

interface WastePayload {
  stock: StWasteStockDTO[];
  items: StWasteMovementDTO[];
}

export default function WastePanel() {
  const { data, loading, error, refresh } = useStockData<WastePayload>(
    '/api/stock/waste',
  );
  const [wasteType, setWasteType] = useState('');
  const [movementType, setMovementType] = useState('sortie');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <Stack spacing={2}>
      {loading ? <LinearProgress /> : null}
      {error ? <Alert severity="error">{error}</Alert> : null}
      {message ? <Alert severity="success">{message}</Alert> : null}

      <Typography variant="subtitle1">
        Déchets textiles (stock séparé, en kg)
      </Typography>
      {(data?.stock.length ?? 0) === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Aucun déchet enregistré par la Coupe.
        </Typography>
      ) : (
        data?.stock.map((waste) => (
          <Paper key={waste.wasteType} variant="outlined" className="p-2">
            <Typography variant="body2">
              {waste.wasteType} : {waste.availableKg} kg disponibles (
              {waste.totalKg} kg entrés, {waste.outKg} kg sortis)
            </Typography>
          </Paper>
        ))
      )}

      {(data?.stock.length ?? 0) > 0 ? (
        <Paper variant="outlined" className="p-3">
          <Stack spacing={2}>
            <Typography variant="body2">Mouvement de déchet</Typography>
            <Stack direction="row" spacing={1} useFlexGap>
              <TextField
                select
                label="Type de déchet"
                size="small"
                value={wasteType}
                onChange={(event) => setWasteType(event.target.value)}
              >
                {(data?.stock ?? []).map((waste) => (
                  <MenuItem key={waste.wasteType} value={waste.wasteType}>
                    {waste.wasteType} ({waste.availableKg} kg dispo.)
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                label="Type de mouvement"
                size="small"
                value={movementType}
                onChange={(event) => setMovementType(event.target.value)}
              >
                <MenuItem value="sortie">Sortie</MenuItem>
                <MenuItem value="ajustement">Ajustement (+/-)</MenuItem>
              </TextField>
              <TextField
                label={`Quantité (kg)${movementType === 'ajustement' ? ' — signé' : ''}`}
                size="small"
                type="number"
                value={qty}
                onChange={(event) => setQty(event.target.value)}
              />
              <TextField
                label="Motif (obligatoire)"
                size="small"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
              <Button
                variant="contained"
                onClick={async () => {
                  setSubmitError(null);
                  try {
                    await sendStock('/api/stock/waste', {
                      wasteType,
                      movementType,
                      qty,
                      reason,
                    });
                    setQty('');
                    setReason('');
                    setMessage('Mouvement de déchet enregistré.');
                    void refresh();
                  } catch (cause) {
                    setSubmitError(
                      cause instanceof Error ? cause.message : 'Erreur inattendue.',
                    );
                  }
                }}
              >
                Enregistrer
              </Button>
            </Stack>
            {submitError ? <Alert severity="error">{submitError}</Alert> : null}
          </Stack>
        </Paper>
      ) : null}

      {(data?.items.length ?? 0) > 0 ? (
        <Paper variant="outlined" className="p-3">
          <Stack spacing={0.5}>
            {data?.items.map((movement) => (
              <Typography key={movement.id} variant="caption" color="text.secondary">
                {movement.createdAt} — {movement.movementType === 'sortie' ? 'Sortie' : 'Ajustement'}{' '}
                {movement.qty} kg — {movement.wasteType} — par{' '}
                {movement.userName ?? '—'} — motif : {movement.reason}
              </Typography>
            ))}
          </Stack>
        </Paper>
      ) : null}
    </Stack>
  );
}
