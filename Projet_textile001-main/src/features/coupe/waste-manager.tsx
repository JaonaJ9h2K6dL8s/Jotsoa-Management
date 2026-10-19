'use client';

import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TablePagination from '@mui/material/TablePagination';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Add from '@mui/icons-material/Add';
import { useState } from 'react';
import { apiPost } from '@/services/api-client';
import { WASTE_TYPE_LABELS, type WasteDTO, type WasteType } from '@/types/coupe';
import { useCoupeData } from './use-coupe';

/** Déclarations de déchets et chutes : liste filtrable et nouvelle déclaration. */
export default function WasteManager() {
  const [wasteType, setWasteType] = useState('all');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const query = `/api/coupe/waste?wasteType=${wasteType === 'all' ? '' : wasteType}`;
  const { data, loading, error, refresh, setError } = useCoupeData<WasteDTO[]>(query);
  const lots = useCoupeData<{ id: number; code: string; status: string }[]>('/api/coupe/lots');
  const [open, setOpen] = useState(false);
  const [lotId, setLotId] = useState('');
  const [type, setType] = useState<WasteType>('chute');
  const [qty, setQty] = useState('');
  const [unit, setUnit] = useState('kg');
  const [reason, setReason] = useState('');
  const [observations, setObservations] = useState('');
  const [saving, setSaving] = useState(false);
  const [info, setInfo] = useState<string | null>(null);

  const rows = data ?? [];
  const activeLots = (lots.data ?? []).filter(
    (lot) => lot.status !== 'annule' && lot.status !== 'transfere',
  );

  async function handleSubmit() {
    setSaving(true);
    setError(null);
    try {
      await apiPost('/api/coupe/waste', {
        lotId: lotId || undefined,
        wasteType: type,
        qty,
        unit,
        reason: reason || undefined,
        observations: observations || undefined,
      });
      setInfo('Déclaration enregistrée.');
      setOpen(false);
      setQty('');
      setReason('');
      setObservations('');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <FormControl size="small" className="min-w-40">
          <InputLabel>Type</InputLabel>
          <Select
            value={wasteType}
            label="Type"
            onChange={(event) => {
              setWasteType(event.target.value);
              setPage(0);
            }}
          >
            <MenuItem value="all">Tous</MenuItem>
            {Object.entries(WASTE_TYPE_LABELS).map(([value, label]) => (
              <MenuItem key={value} value={value}>
                {label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Button variant="contained" startIcon={<Add />} onClick={() => setOpen(true)}>
          Nouvelle déclaration
        </Button>
      </Stack>

      {error ? <Alert severity="error">{error}</Alert> : null}
      {info ? (
        <Alert severity="success" onClose={() => setInfo(null)}>
          {info}
        </Alert>
      ) : null}

      <TableContainer component="div" className="overflow-x-auto rounded border">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Lot</TableCell>
              <TableCell>Type</TableCell>
              <TableCell align="right">Quantité</TableCell>
              <TableCell>Motif</TableCell>
              <TableCell>Par</TableCell>
              <TableCell>Date</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="py-6 text-center">
                  <CircularProgress size={24} />
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-6 text-center">
                  Aucune déclaration de déchet.
                </TableCell>
              </TableRow>
            ) : (
              rows
                .slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)
                .map((row) => (
                  <TableRow key={row.id} hover>
                    <TableCell>{row.lotCode ?? '—'}</TableCell>
                    <TableCell>{WASTE_TYPE_LABELS[row.wasteType] ?? row.wasteType}</TableCell>
                    <TableCell align="right">
                      {row.qty} {row.unit}
                    </TableCell>
                    <TableCell>{row.reason ?? row.observations ?? '—'}</TableCell>
                    <TableCell>{row.userName ?? '—'}</TableCell>
                    <TableCell>{row.createdAt}</TableCell>
                  </TableRow>
                ))
            )}
          </TableBody>
        </Table>
        <TablePagination
          component="div"
          count={rows.length}
          page={page}
          onPageChange={(_, value) => setPage(value)}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={(event) => {
            setRowsPerPage(Number(event.target.value));
            setPage(0);
          }}
          rowsPerPageOptions={[5, 10, 25]}
          labelRowsPerPage="Lignes par page"
        />
      </TableContainer>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Nouvelle déclaration de déchet</DialogTitle>
        <DialogContent>
          <Stack spacing={2} className="pt-1">
            <FormControl size="small">
              <InputLabel>Lot concerné (facultatif)</InputLabel>
              <Select
                value={lotId}
                label="Lot concerné (facultatif)"
                onChange={(event) => setLotId(event.target.value)}
              >
                <MenuItem value="">— Aucun —</MenuItem>
                {activeLots.map((lot) => (
                  <MenuItem key={lot.id} value={lot.id}>
                    {lot.code}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" required>
              <InputLabel>Type de déchet</InputLabel>
              <Select
                value={type}
                label="Type de déchet"
                onChange={(event) => setType(event.target.value as WasteType)}
              >
                {Object.entries(WASTE_TYPE_LABELS).map(([value, label]) => (
                  <MenuItem key={value} value={value}>
                    {label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Stack direction="row" spacing={2}>
              <TextField
                label="Quantité"
                required
                type="number"
                inputProps={{ min: 0, step: '0.01' }}
                value={qty}
                onChange={(event) => setQty(event.target.value)}
                className="flex-1"
              />
              <TextField
                label="Unité"
                value={unit}
                onChange={(event) => setUnit(event.target.value)}
                className="w-32"
              />
            </Stack>
            <TextField
              label="Motif"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
            <TextField
              label="Observations"
              multiline
              minRows={2}
              value={observations}
              onChange={(event) => setObservations(event.target.value)}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)} disabled={saving}>
            Annuler
          </Button>
          <Button onClick={handleSubmit} variant="contained" disabled={saving || !qty}>
            {saving ? 'Enregistrement…' : 'Déclarer'}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
