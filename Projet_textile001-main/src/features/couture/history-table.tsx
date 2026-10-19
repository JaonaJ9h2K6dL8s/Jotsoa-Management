'use client';

import { useState } from 'react';
import Alert from '@mui/material/Alert';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { CoutureHistoryDTO } from '@/types/couture';
import { useCoutureData } from './use-couture';

/**
 * Historique complet du module Couture : lecture seule, chaque
 * opération majeure y est tracée avec son auteur et son motif.
 */

const ENTITY_TYPES = [
  'reception',
  'affectation',
  'production',
  'incident',
  'transfert_cq',
  'demande_sensitive',
  'alerte',
  'ligne_couture',
  'salle_couture',
  'lot_couture',
] as const;

function formatTimestamp(value: string): string {
  const date = new Date(value.includes('T') ? value : value.replace(' ', 'T') + 'Z');
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

export default function HistoryTable() {
  const [entityType, setEntityType] = useState('');
  const [entityId, setEntityId] = useState('');
  const query = new URLSearchParams();
  if (entityType) query.set('entityType', entityType);
  if (entityId) query.set('entityId', entityId);
  const { data, loading, error } = useCoutureData<CoutureHistoryDTO[]>(
    `/api/couture/history${query.toString() ? `?${query.toString()}` : ''}`,
  );

  return (
    <Stack spacing={2}>
      {loading ? <LinearProgress /> : null}
      {error ? <Alert severity="error">{error}</Alert> : null}
      <Stack direction="row" spacing={2} useFlexGap className="flex-wrap items-center">
        <TextField
          select
          label="Type d'objet"
          size="small"
          value={entityType}
          onChange={(event) => setEntityType(event.target.value)}
          className="w-64"
        >
          <MenuItem value="">Tous</MenuItem>
          {ENTITY_TYPES.map((type) => (
            <MenuItem key={type} value={type}>
              {type}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          label="Identifiant"
          size="small"
          value={entityId}
          onChange={(event) => setEntityId(event.target.value)}
          className="w-40"
        />
      </Stack>
      {(data ?? []).length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Aucune opération trouvée pour ces filtres.
        </Typography>
      ) : (
        (data ?? []).map((entry) => (
          <Paper key={entry.id} variant="outlined" className="p-3">
            <Typography variant="body1">
              {entry.action} — {entry.entityType} #{entry.entityId}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Par {entry.actorNom ?? '—'} — {formatTimestamp(entry.createdAt)}
              {entry.reason ? ` — motif : ${entry.reason}` : ''}
            </Typography>
            {entry.oldValue || entry.newValue ? (
              <Typography
                variant="caption"
                color="text.secondary"
                className="break-all"
              >
                Avant : {entry.oldValue ?? '—'} · Après : {entry.newValue ?? '—'}
              </Typography>
            ) : null}
          </Paper>
        ))
      )}
    </Stack>
  );
}
