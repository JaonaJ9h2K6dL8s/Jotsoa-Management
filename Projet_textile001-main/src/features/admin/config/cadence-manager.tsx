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
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPatch, apiPost } from '@/services/api-client';
import type { CadenceRow, ReferenceRow, SewingLineRow, SewingRoomRow } from '@/types/config';

/**
 * Configuration des cadences et objectifs de production.
 * Une seule configuration active par contexte (type / salle / ligne).
 */

const EMPTY = {
  productTypeId: '',
  roomId: '',
  lineId: '',
  value: '',
  unit: 'pièces/heure',
  period: 'heure',
  startDate: '',
  endDate: '',
};

function contextLabel(row: CadenceRow): string {
  const parts: string[] = [];
  parts.push(row.productTypeNom ?? 'Tous types');
  if (row.lineNom) parts.push(`Ligne ${row.lineNom}`);
  else if (row.roomNom) parts.push(row.roomNom);
  else parts.push('Toutes salles');
  return parts.join(' — ');
}

export default function CadenceManager() {
  const [rows, setRows] = useState<CadenceRow[]>([]);
  const [types, setTypes] = useState<ReferenceRow[]>([]);
  const [rooms, setRooms] = useState<SewingRoomRow[]>([]);
  const [lines, setLines] = useState<SewingLineRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CadenceRow | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cadences, typesResult, roomsResult, linesResult] = await Promise.all([
        apiGet<{ items: CadenceRow[] }>('/api/config/cadences'),
        apiGet<{ items: ReferenceRow[] }>('/api/config/simple/product-types'),
        apiGet<{ items: SewingRoomRow[] }>('/api/config/sewing-rooms'),
        apiGet<{ items: SewingLineRow[] }>('/api/config/sewing-lines'),
      ]);
      setRows(cadences.items);
      setTypes(typesResult.items);
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

  function openCreate() {
    setEditing(null);
    setForm(EMPTY);
    setDialogOpen(true);
  }

  function openEdit(row: CadenceRow) {
    setEditing(row);
    setForm({
      productTypeId: row.productTypeId ? String(row.productTypeId) : '',
      roomId: row.roomId ? String(row.roomId) : '',
      lineId: row.lineId ? String(row.lineId) : '',
      value: String(row.value),
      unit: row.unit,
      period: row.period,
      startDate: row.startDate,
      endDate: row.endDate ?? '',
    });
    setDialogOpen(true);
  }

  async function handleSubmit() {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        productTypeId: form.productTypeId || null,
        roomId: form.lineId ? '' : form.roomId || null,
        lineId: form.lineId || null,
        value: Number(form.value),
        unit: form.unit,
        period: form.period,
        startDate: form.startDate,
        endDate: form.endDate || null,
      };
      if (editing) {
        await apiPatch(`/api/config/cadences/${editing.id}`, payload);
        setInfo('Cadence modifiée.');
      } else {
        await apiPost('/api/config/cadences', payload);
        setInfo('Cadence créée.');
      }
      setDialogOpen(false);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(row: CadenceRow) {
    if (
      !window.confirm(
        row.isActive
          ? 'Désactiver cette cadence ?'
          : 'Réactiver cette cadence ? Elle entrera en conflit si une autre configuration active existe pour ce contexte.',
      )
    ) {
      return;
    }
    setError(null);
    try {
      await apiPatch(`/api/config/cadences/${row.id}`, { isActive: !row.isActive });
      setInfo(row.isActive ? 'Cadence désactivée.' : 'Cadence réactivée.');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur.');
    }
  }

  const availableLines = form.roomId
    ? lines.filter((line) => line.roomId === Number(form.roomId) && line.isActive)
    : [];

  return (
    <Stack spacing={2}>
      <Stack direction="row" justifyContent="flex-end">
        <Button variant="contained" startIcon={<Add />} onClick={openCreate}>
          Nouvelle cadence
        </Button>
      </Stack>

      {error ? <Alert severity="error">{error}</Alert> : null}
      {info ? (
        <Alert severity="success" onClose={() => setInfo(null)}>
          {info}
        </Alert>
      ) : null}

      <Paper variant="outlined">
        {loading ? (
          <Stack className="py-8" alignItems="center">
            <CircularProgress size={28} />
          </Stack>
        ) : rows.length === 0 ? (
          <Alert severity="info">
            Aucune cadence configurée. Les valeurs initiales sont définies par
            l&apos;administrateur.
          </Alert>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Contexte</TableCell>
                <TableCell>Valeur</TableCell>
                <TableCell>Période</TableCell>
                <TableCell>Validité</TableCell>
                <TableCell>Statut</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{contextLabel(row)}</TableCell>
                  <TableCell>
                    {row.value} {row.unit}
                  </TableCell>
                  <TableCell>
                    <Chip label={row.period === 'heure' ? 'Par heure' : 'Par jour'} size="small" variant="outlined" />
                  </TableCell>
                  <TableCell>
                    {row.startDate} → {row.endDate ?? '…'}
                  </TableCell>
                  <TableCell>{row.isActive ? 'Active' : 'Désactivée'}</TableCell>
                  <TableCell align="right">
                    <Button size="small" onClick={() => openEdit(row)}>
                      Modifier
                    </Button>
                    <Button size="small" onClick={() => toggleActive(row)}>
                      {row.isActive ? 'Désactiver' : 'Réactiver'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Paper>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? 'Modifier la cadence' : 'Nouvelle cadence'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} className="pt-1">
            <TextField
              select
              label="Type de produit (facultatif)"
              value={form.productTypeId}
              onChange={(event) => setForm({ ...form, productTypeId: event.target.value })}
              helperText="Vide = tous les types"
              fullWidth
            >
              <MenuItem value="">— Tous les types —</MenuItem>
              {types.map((type) => (
                <MenuItem key={type.id} value={type.id}>
                  {type.nom}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Salle (facultatif)"
              value={form.roomId}
              onChange={(event) =>
                setForm({ ...form, roomId: event.target.value, lineId: '' })
              }
              helperText="Vide = toutes les salles"
              fullWidth
            >
              <MenuItem value="">— Toutes les salles —</MenuItem>
              {rooms
                .filter((room) => room.isActive)
                .map((room) => (
                  <MenuItem key={room.id} value={room.id}>
                    {room.nom}
                  </MenuItem>
                ))}
            </TextField>
            <TextField
              select
              label="Ligne (facultatif)"
              value={form.lineId}
              onChange={(event) => setForm({ ...form, lineId: event.target.value })}
              helperText={
                form.roomId
                  ? 'Lignes de la salle sélectionnée'
                  : 'Choisissez une salle pour sélectionner une ligne'
              }
              fullWidth
            >
              <MenuItem value="">— Toute la salle —</MenuItem>
              {availableLines.map((line) => (
                <MenuItem key={line.id} value={line.id}>
                  {line.code} — {line.nom}
                </MenuItem>
              ))}
            </TextField>
            <Stack direction="row" spacing={2}>
              <TextField
                label="Valeur de cadence"
                type="number"
                value={form.value}
                onChange={(event) => setForm({ ...form, value: event.target.value })}
                required
                fullWidth
              />
              <TextField
                label="Unité"
                value={form.unit}
                onChange={(event) => setForm({ ...form, unit: event.target.value })}
                required
                fullWidth
                helperText="Ex. pièces/heure"
              />
            </Stack>
            <Stack direction="row" spacing={2}>
              <TextField
                select
                label="Période de référence"
                value={form.period}
                onChange={(event) => setForm({ ...form, period: event.target.value })}
                fullWidth
              >
                <MenuItem value="heure">Par heure</MenuItem>
                <MenuItem value="jour">Par jour</MenuItem>
              </TextField>
              <TextField
                label="Début d'application"
                type="date"
                value={form.startDate}
                onChange={(event) => setForm({ ...form, startDate: event.target.value })}
                required
                fullWidth
                slotProps={{ inputLabel: { shrink: true } }}
              />
            </Stack>
            <TextField
              label="Date de fin (facultative)"
              type="date"
              value={form.endDate}
              onChange={(event) => setForm({ ...form, endDate: event.target.value })}
              fullWidth
              slotProps={{ inputLabel: { shrink: true } }}
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
