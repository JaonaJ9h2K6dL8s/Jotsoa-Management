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
import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiPatch, apiPost } from '@/services/api-client';
import type { DefectRow, ReferenceRow, ReworkZoneRow } from '@/types/config';

/**
 * Gestion des défauts qualité avec associations types de produits
 * et zones de retouche (facultatives selon les défauts).
 */

const EMPTY = { code: '', nom: '', description: '', category: '' };

export default function DefectManager() {
  const [defects, setDefects] = useState<DefectRow[]>([]);
  const [types, setTypes] = useState<ReferenceRow[]>([]);
  const [zones, setZones] = useState<ReworkZoneRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<DefectRow | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [typeIds, setTypeIds] = useState<number[]>([]);
  const [zoneIds, setZoneIds] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [defectsResult, typesResult, zonesResult] = await Promise.all([
        apiGet<{ items: DefectRow[] }>(
          `/api/config/defects${search.trim() ? `?search=${encodeURIComponent(search.trim())}` : ''}`,
        ),
        apiGet<{ items: ReferenceRow[] }>('/api/config/simple/product-types'),
        apiGet<{ items: ReworkZoneRow[] }>('/api/config/rework-zones'),
      ]);
      setDefects(defectsResult.items);
      setTypes(typesResult.items);
      setZones(zonesResult.items);
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

  const categories = useMemo(
    () =>
      Array.from(
        new Set(defects.map((defect) => defect.category).filter((value): value is string => Boolean(value))),
      ).sort(),
    [defects],
  );

  function openCreate() {
    setEditing(null);
    setForm(EMPTY);
    setTypeIds([]);
    setZoneIds([]);
    setDialogOpen(true);
  }

  function openEdit(defect: DefectRow) {
    setEditing(defect);
    setForm({
      code: defect.code,
      nom: defect.nom,
      description: defect.description ?? '',
      category: defect.category ?? '',
    });
    setTypeIds(defect.productTypeIds);
    setZoneIds(defect.zoneIds);
    setDialogOpen(true);
  }

  async function handleSubmit() {
    setSaving(true);
    setError(null);
    try {
      const payload = { ...form, productTypeIds: typeIds, zoneIds };
      if (editing) {
        await apiPatch(`/api/config/defects/${editing.id}`, payload);
        setInfo('Défaut modifié.');
      } else {
        await apiPost('/api/config/defects', payload);
        setInfo('Défaut créé.');
      }
      setDialogOpen(false);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(defect: DefectRow) {
    if (
      !window.confirm(
        defect.isActive
          ? `Désactiver le défaut « ${defect.nom} » ? Les historiques restent consultables.`
          : `Réactiver le défaut « ${defect.nom} » ?`,
      )
    ) {
      return;
    }
    try {
      await apiPatch(`/api/config/defects/${defect.id}`, { isActive: !defect.isActive });
      setInfo(defect.isActive ? 'Défaut désactivé.' : 'Défaut réactivé.');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur.');
    }
  }

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <TextField
          label="Rechercher (code ou libellé)…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="flex-1"
          size="small"
        />
        <Button variant="contained" startIcon={<Add />} onClick={openCreate}>
          Nouveau défaut
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
        ) : defects.length === 0 ? (
          <Alert severity="info">Aucun défaut configuré.</Alert>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Code</TableCell>
                <TableCell>Libellé</TableCell>
                <TableCell>Catégorie</TableCell>
                <TableCell>Types associés</TableCell>
                <TableCell>Zones associées</TableCell>
                <TableCell>Statut</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {defects.map((defect) => (
                <TableRow key={defect.id}>
                  <TableCell>{defect.code}</TableCell>
                  <TableCell>{defect.nom}</TableCell>
                  <TableCell>{defect.category ?? '—'}</TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
                      {defect.productTypeIds.length === 0
                        ? 'Tous'
                        : defect.productTypeIds.map((id) => (
                            <Chip
                              key={id}
                              label={types.find((type) => type.id === id)?.nom ?? `#${id}`}
                              size="small"
                            />
                          ))}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
                      {defect.zoneIds.length === 0
                        ? '—'
                        : defect.zoneIds.map((id) => (
                            <Chip
                              key={id}
                              label={zones.find((zone) => zone.id === id)?.nom ?? `#${id}`}
                              size="small"
                              variant="outlined"
                            />
                          ))}
                    </Stack>
                  </TableCell>
                  <TableCell>{defect.isActive ? 'Actif' : 'Inactif'}</TableCell>
                  <TableCell align="right">
                    <Button size="small" onClick={() => openEdit(defect)}>
                      Modifier
                    </Button>
                    <Button size="small" onClick={() => toggleActive(defect)}>
                      {defect.isActive ? 'Désactiver' : 'Réactiver'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Paper>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? `Modifier : ${editing.nom}` : 'Nouveau défaut'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} className="pt-1">
            <TextField
              label="Code unique"
              value={form.code}
              onChange={(event) => setForm({ ...form, code: event.target.value })}
              required
              fullWidth
              helperText="2 à 20 caractères : lettres, chiffres, - _ (ex. DEF-010)"
            />
            <TextField
              label="Libellé"
              value={form.nom}
              onChange={(event) => setForm({ ...form, nom: event.target.value })}
              required
              fullWidth
            />
            <TextField
              label="Catégorie (facultatif)"
              value={form.category}
              onChange={(event) => setForm({ ...form, category: event.target.value })}
              fullWidth
              helperText={
                categories.length > 0
                  ? `Catégories existantes : ${categories.join(', ')}`
                  : 'Ex. Couture, Propreté, Dimensions, Finition'
              }
            />
            <TextField
              label="Description (facultative)"
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
              multiline
              minRows={2}
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
              helperText="Vide = applicable à tous les types"
              fullWidth
            >
              {types.map((type) => (
                <MenuItem key={type.id} value={type.id}>
                  {type.nom}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Zones de retouche associées (facultatif)"
              value={zoneIds}
              onChange={(event) =>
                setZoneIds(
                  String(event.target.value)
                    .split(',')
                    .filter(Boolean)
                    .map(Number),
                )
              }
              SelectProps={{ multiple: true }}
              helperText="Pertinent uniquement pour certains défauts"
              fullWidth
            >
              {zones.map((zone) => (
                <MenuItem key={zone.id} value={zone.id}>
                  {zone.nom}
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
    </Stack>
  );
}
