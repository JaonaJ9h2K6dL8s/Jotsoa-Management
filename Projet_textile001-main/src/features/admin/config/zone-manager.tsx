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
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TablePagination from '@mui/material/TablePagination';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPatch, apiPost } from '@/services/api-client';
import type { ReferenceRow, ReworkZoneRow } from '@/types/config';

/**
 * Gestion des zones de retouche avec association aux types de produits.
 * Les zones seront chargées dynamiquement par le futur module Retouche.
 */

export default function ZoneManager() {
  const [zones, setZones] = useState<ReworkZoneRow[]>([]);
  const [types, setTypes] = useState<ReferenceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ReworkZoneRow | null>(null);
  const [nom, setNom] = useState('');
  const [displayOrder, setDisplayOrder] = useState('1');
  const [typeIds, setTypeIds] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [zonesResult, typesResult] = await Promise.all([
        apiGet<{ items: ReworkZoneRow[] }>(
          `/api/config/rework-zones${search.trim() ? `?search=${encodeURIComponent(search.trim())}` : ''}`,
        ),
        apiGet<{ items: ReferenceRow[] }>('/api/config/simple/product-types'),
      ]);
      setZones(zonesResult.items);
      setTypes(typesResult.items);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur de chargement.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = setTimeout(refresh, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const typeName = useMemo(() => {
    const map = new Map<number, string>();
    for (const type of types) map.set(type.id, type.nom);
    return map;
  }, [types]);

  function openCreate() {
    setEditing(null);
    setNom('');
    setDisplayOrder(String(zones.length + 1));
    setTypeIds([]);
    setDialogOpen(true);
  }

  function openEdit(zone: ReworkZoneRow) {
    setEditing(zone);
    setNom(zone.nom);
    setDisplayOrder(String(zone.displayOrder ?? 1));
    setTypeIds(zone.productTypeIds);
    setDialogOpen(true);
  }

  async function handleSubmit() {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        nom,
        displayOrder: Number(displayOrder || 1),
        productTypeIds: typeIds,
      };
      if (editing) {
        await apiPatch(`/api/config/rework-zones/${editing.id}`, payload);
        setInfo('Zone modifiée.');
      } else {
        await apiPost('/api/config/rework-zones', payload);
        setInfo('Zone créée.');
      }
      setDialogOpen(false);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(zone: ReworkZoneRow) {
    if (
      !window.confirm(
        zone.isActive
          ? `Désactiver la zone « ${zone.nom} » ? Les associations sont conservées.`
          : `Réactiver la zone « ${zone.nom} » ?`,
      )
    ) {
      return;
    }
    try {
      await apiPatch(`/api/config/rework-zones/${zone.id}`, { isActive: !zone.isActive });
      setInfo(zone.isActive ? 'Zone désactivée.' : 'Zone réactivée.');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur.');
    }
  }

  const visible = zones.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <TextField
          label="Rechercher une zone…"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(0);
          }}
          className="flex-1"
          size="small"
        />
        <Button variant="contained" startIcon={<Add />} onClick={openCreate}>
          Nouvelle zone
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
        ) : zones.length === 0 ? (
          <Alert severity="info">Aucune zone de retouche configurée.</Alert>
        ) : (
          <TableContainer component="div">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Zone</TableCell>
                  <TableCell>Ordre</TableCell>
                  <TableCell>Types de produits associés</TableCell>
                  <TableCell>Statut</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {visible.map((zone) => (
                  <TableRow key={zone.id}>
                    <TableCell>{zone.nom}</TableCell>
                    <TableCell>{zone.displayOrder}</TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
                        {zone.productTypeIds.length === 0
                          ? '—'
                          : zone.productTypeIds.map((id) => (
                              <Chip key={id} label={typeName.get(id) ?? `#${id}`} size="small" />
                            ))}
                      </Stack>
                    </TableCell>
                    <TableCell>{zone.isActive ? 'Active' : 'Désactivée'}</TableCell>
                    <TableCell align="right">
                      <Button size="small" onClick={() => openEdit(zone)}>
                        Modifier
                      </Button>
                      <Button size="small" onClick={() => toggleActive(zone)}>
                        {zone.isActive ? 'Désactiver' : 'Réactiver'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? `Modifier : ${editing.nom}` : 'Nouvelle zone de retouche'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} className="pt-1">
            <TextField
              label="Libellé de la zone"
              value={nom}
              onChange={(event) => setNom(event.target.value)}
              required
              fullWidth
            />
            <TextField
              label="Ordre d'affichage"
              type="number"
              value={displayOrder}
              onChange={(event) => setDisplayOrder(event.target.value)}
              helperText="Entier entre 1 et 999"
              fullWidth
            />
            <TextField
              select
              label="Types de produits concernés"
              value={typeIds}
              onChange={(event) =>
                setTypeIds(
                  String(event.target.value)
                    .split(',')
                    .filter(Boolean)
                    .map(Number),
                )
              }
              SelectProps={{ multiple: true }}
              helperText="Laisser vide si la zone s'applique à tous les types"
              fullWidth
            >
              {types.map((type) => (
                <MenuItem key={type.id} value={type.id}>
                  {type.nom}
                </MenuItem>
              ))}
            </TextField>
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

      <TablePagination
        component="div"
        count={zones.length}
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
    </Stack>
  );
}
