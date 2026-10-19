'use client';

import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import LinearProgress from '@mui/material/LinearProgress';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { CoutureRoomDTO } from '@/types/couture';
import { sendCouture, useCoutureData } from './use-couture';

/**
 * Salles de couture et lignes de production, lues depuis SQLite.
 * Une ligne ou une salle occupée par des affectations actives ne
 * peut pas être désactivée.
 */

function LineRow({ line, onDone }: { line: CoutureRoomDTO['lines'][number]; onDone: () => void }) {
  const [nom, setNom] = useState(line.nom);
  const [error, setError] = useState<string | null>(null);
  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    setError(null);
    try {
      await sendCouture(`/api/couture/lines/${line.id}`, 'PATCH', { action, ...extra });
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur inattendue.');
    }
  };
  return (
    <Stack direction="row" spacing={1} alignItems="center" useFlexGap className="flex-wrap">
      <Chip size="small" label={line.code} />
      <TextField
        size="small"
        value={nom}
        onChange={(event) => setNom(event.target.value)}
        className="w-56"
      />
      <Button size="small" onClick={() => act('rename', { nom })}>
        Renommer
      </Button>
      {line.isActive ? (
        <Button size="small" color="warning" onClick={() => act('deactivate')}>
          Désactiver
        </Button>
      ) : (
        <Button size="small" color="success" onClick={() => act('activate')}>
          Activer
        </Button>
      )}
      <Chip size="small" label={line.isActive ? 'Active' : 'Désactivée'} />
      {error ? <Alert severity="error">{error}</Alert> : null}
    </Stack>
  );
}

export default function RoomsManager() {
  const { data, loading, error, refresh } = useCoutureData<CoutureRoomDTO[]>(
    '/api/couture/rooms',
  );
  const [newLine, setNewLine] = useState({ roomId: '', code: '', nom: '' });
  const [formError, setFormError] = useState<string | null>(null);

  const createLine = async () => {
    setFormError(null);
    try {
      await sendCouture('/api/couture/lines', 'POST', {
        roomId: Number(newLine.roomId),
        code: newLine.code,
        nom: newLine.nom,
      });
      setNewLine({ roomId: '', code: '', nom: '' });
      void refresh();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Erreur inattendue.');
    }
  };

  return (
    <Stack spacing={3}>
      {loading ? <LinearProgress /> : null}
      {error ? <Alert severity="error">{error}</Alert> : null}
      {formError ? <Alert severity="error">{formError}</Alert> : null}

      {(data ?? []).map((room) => (
        <Paper key={room.id} variant="outlined" className="p-3">
          <Stack spacing={2}>
            <Stack direction="row" spacing={1} alignItems="center" useFlexGap>
              <Typography variant="subtitle1">{room.nom}</Typography>
              <Chip size="small" label={room.code} />
              <Chip size="small" label={room.isActive ? 'Active' : 'Désactivée'} />
            </Stack>
            <Stack spacing={1}>
              {room.lines.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  Aucune ligne dans cette salle.
                </Typography>
              ) : (
                room.lines.map((line) => (
                  <LineRow key={line.id} line={line} onDone={() => void refresh()} />
                ))
              )}
            </Stack>
          </Stack>
        </Paper>
      ))}

      <Paper variant="outlined" className="p-3">
        <Typography variant="subtitle1" gutterBottom>
          Créer une ligne de production
        </Typography>
        <Stack direction="row" spacing={2} useFlexGap className="flex-wrap items-center">
          <TextField
            select
            label="Salle"
            size="small"
            value={newLine.roomId}
            onChange={(event) => setNewLine((prev) => ({ ...prev, roomId: event.target.value }))}
          >
            {(data ?? [])
              .filter((room) => room.isActive)
              .map((room) => (
                <MenuItem key={room.id} value={String(room.id)}>
                  {room.nom}
                </MenuItem>
              ))}
          </TextField>
          <TextField
            label="Code"
            size="small"
            value={newLine.code}
            onChange={(event) => setNewLine((prev) => ({ ...prev, code: event.target.value }))}
          />
          <TextField
            label="Nom"
            size="small"
            value={newLine.nom}
            onChange={(event) => setNewLine((prev) => ({ ...prev, nom: event.target.value }))}
          />
          <Button
            variant="contained"
            onClick={createLine}
            disabled={!newLine.roomId || !newLine.code.trim() || !newLine.nom.trim()}
          >
            Créer
          </Button>
        </Stack>
      </Paper>
    </Stack>
  );
}
