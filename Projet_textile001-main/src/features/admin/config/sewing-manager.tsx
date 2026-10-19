'use client';

import Add from '@mui/icons-material/Add';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Grid from '@mui/material/Grid';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPatch, apiPost } from '@/services/api-client';
import type { SewingLineRow, SewingRoomRow } from '@/types/config';

/**
 * Configuration des trois salles de couture et de leurs lignes.
 * Les salles sont créées par migration (aucune création/suppression) ;
 * les lignes appartiennent à une seule salle.
 */
export default function SewingManager() {
  const [rooms, setRooms] = useState<SewingRoomRow[]>([]);
  const [lines, setLines] = useState<SewingLineRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SewingLineRow | null>(null);
  const [roomContext, setRoomContext] = useState<SewingRoomRow | null>(null);
  const [code, setCode] = useState('');
  const [nom, setNom] = useState('');
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [roomsResult, linesResult] = await Promise.all([
        apiGet<{ items: SewingRoomRow[] }>('/api/config/sewing-rooms'),
        apiGet<{ items: SewingLineRow[] }>('/api/config/sewing-lines'),
      ]);
      setRooms(roomsResult.items);
      setLines(linesResult.items);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur de chargement.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function openCreateLine(room: SewingRoomRow) {
    setEditing(null);
    setRoomContext(room);
    setCode(`L-${room.code.split('-')[1] ?? room.code}-`);
    setNom('');
    setDialogOpen(true);
  }

  function openEditLine(line: SewingLineRow) {
    setEditing(line);
    setRoomContext(null);
    setCode(line.code);
    setNom(line.nom);
    setDialogOpen(true);
  }

  async function handleSubmit() {
    setSaving(true);
    setError(null);
    try {
      if (editing) {
        await apiPatch(`/api/config/sewing-lines/${editing.id}`, { code, nom });
        setInfo('Ligne modifiée.');
      } else if (roomContext) {
        await apiPost('/api/config/sewing-lines', { code, nom, roomId: roomContext.id });
        setInfo('Ligne créée.');
      }
      setDialogOpen(false);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(row: { id: number; isActive: boolean; nom: string; kind: 'room' | 'line' }) {
    const label = row.kind === 'room' ? 'la salle' : 'la ligne';
    if (
      !window.confirm(
        row.isActive
          ? `Désactiver ${label} « ${row.nom} » ? Les références existantes sont préservées.`
          : `Réactiver ${label} « ${row.nom} » ?`,
      )
    ) {
      return;
    }
    setError(null);
    try {
      if (row.kind === 'room') {
        await apiPatch('/api/config/sewing-rooms', { id: row.id, isActive: !row.isActive });
      } else {
        await apiPatch(`/api/config/sewing-lines/${row.id}`, { isActive: !row.isActive });
      }
      setInfo(row.isActive ? 'Élément désactivé.' : 'Élément réactivé.');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur.');
    }
  }

  return (
    <Stack spacing={3}>
      {error ? <Alert severity="error">{error}</Alert> : null}
      {info ? (
        <Alert severity="success" onClose={() => setInfo(null)}>
          {info}
        </Alert>
      ) : null}

      {loading ? (
        <Stack className="py-8" alignItems="center">
          <CircularProgress size={28} />
        </Stack>
      ) : (
        <Grid container spacing={2}>
          {rooms.map((room) => {
            const roomLines = lines.filter((line) => line.roomId === room.id);
            return (
              <Grid key={room.id} size={{ xs: 12, md: 4 }}>
                <Paper variant="outlined" className="h-full p-3">
                  <Stack spacing={1}>
                    <Stack direction="row" alignItems="center" justifyContent="space-between">
                      <Typography variant="subtitle1" component="h3">
                        {room.nom}
                      </Typography>
                      <Chip
                        label={room.isActive ? 'Active' : 'Désactivée'}
                        size="small"
                        color={room.isActive ? 'success' : 'default'}
                        variant="outlined"
                      />
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      Code : {room.code} — {roomLines.length} ligne(s)
                    </Typography>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Code</TableCell>
                          <TableCell>Ligne</TableCell>
                          <TableCell align="right">Actions</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {roomLines.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={3}>Aucune ligne.</TableCell>
                          </TableRow>
                        ) : (
                          roomLines.map((line) => (
                            <TableRow key={line.id}>
                              <TableCell>{line.code}</TableCell>
                              <TableCell>
                                {line.nom}
                                {line.isActive ? '' : ' (désactivée)'}
                              </TableCell>
                              <TableCell align="right">
                                <Button size="small" onClick={() => openEditLine(line)}>
                                  Modifier
                                </Button>
                                <Button
                                  size="small"
                                  onClick={() =>
                                    toggleActive({ id: line.id, isActive: line.isActive, nom: line.nom, kind: 'line' })
                                  }
                                >
                                  {line.isActive ? 'Désact.' : 'Réact.'}
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                    <Stack direction="row" spacing={1}>
                      <Button
                        size="small"
                        startIcon={<Add />}
                        onClick={() => openCreateLine(room)}
                        disabled={!room.isActive}
                      >
                        Ajouter une ligne
                      </Button>
                      <Button
                        size="small"
                        onClick={() =>
                          toggleActive({ id: room.id, isActive: room.isActive, nom: room.nom, kind: 'room' })
                        }
                      >
                        {room.isActive ? 'Désactiver la salle' : 'Réactiver la salle'}
                      </Button>
                    </Stack>
                  </Stack>
                </Paper>
              </Grid>
            );
          })}
        </Grid>
      )}

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>
          {editing ? `Modifier la ligne : ${editing.code}` : `Nouvelle ligne — ${roomContext?.nom ?? ''}`}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} className="pt-1">
            <TextField
              label="Code de la ligne"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              required
              fullWidth
              helperText="Unique dans la salle (2 à 20 caractères)"
            />
            <TextField
              label="Nom ou numéro"
              value={nom}
              onChange={(event) => setNom(event.target.value)}
              required
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)} disabled={saving}>
            Annuler
          </Button>
          <Button onClick={handleSubmit} variant="contained" disabled={saving}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
