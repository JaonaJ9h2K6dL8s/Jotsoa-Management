'use client';

import Add from '@mui/icons-material/Add';
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
import Paper from '@mui/material/Paper';
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
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { apiPatch, apiPost } from '@/services/api-client';

/**
 * Gestionnaire générique d'entités de référence (types de produits,
 * couleurs, tailles) : recherche, filtre statut, pagination, tri,
 * création, modification et activation/désactivation confirmée.
 */

export type EntityRow = Record<string, unknown>;

export interface EntityField {
  name: string;
  label: string;
  type?: 'text' | 'textarea' | 'color' | 'number';
  required?: boolean;
  helper?: string;
}

export interface EntityColumn {
  key: string;
  label: string;
  render?: (row: EntityRow) => ReactNode;
  sortValue?: (row: EntityRow) => string | number;
}

interface Props {
  title: string;
  singular: string;
  endpoint: string;
  columns: EntityColumn[];
  fields: EntityField[];
  searchPlaceholder: string;
}

function asString(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

export default function EntityManager({
  title,
  singular,
  endpoint,
  columns,
  fields,
  searchPlaceholder,
}: Props) {
  const [rows, setRows] = useState<EntityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<EntityRow | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (status !== 'all') params.set('status', status);
      const response = await fetch(`${endpoint}?${params.toString()}`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      const body = (await response.json()) as {
        status: string;
        items?: EntityRow[];
        message?: string;
      };
      if (!response.ok) throw new Error(body.message ?? 'Erreur de chargement.');
      setRows(body.items ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur de chargement.');
    } finally {
      setLoading(false);
    }
  }, [endpoint, search, status]);

  useEffect(() => {
    const timer = setTimeout(refresh, 250);
    return () => clearTimeout(timer);
  }, [refresh]);

  const sortedRows = useMemo(() => {
    if (!sortKey) return rows;
    const column = columns.find((item) => item.key === sortKey);
    if (!column?.sortValue) return rows;
    return [...rows].sort((a, b) => {
      const va = column.sortValue?.(a) ?? '';
      const vb = column.sortValue?.(b) ?? '';
      if (va < vb) return sortAsc ? -1 : 1;
      if (va > vb) return sortAsc ? 1 : -1;
      return 0;
    });
  }, [rows, sortKey, sortAsc, columns]);

  function openCreate() {
    setEditing(null);
    setForm(
      Object.fromEntries(fields.map((field) => [field.name, ''])),
    );
    setError(null);
    setDialogOpen(true);
  }

  function openEdit(row: EntityRow) {
    setEditing(row);
    setForm(
      Object.fromEntries(
        fields.map((field) => [field.name, asString(row[field.name])]),
      ),
    );
    setError(null);
    setDialogOpen(true);
  }

  async function handleSubmit() {
    setSaving(true);
    setError(null);
    try {
      const payload = Object.fromEntries(
        Object.entries(form).filter(([, value]) => value !== ''),
      );
      if (editing) {
        await apiPatch(`${endpoint}/${editing.id}`, payload);
        setInfo(`${singular} modifié(e).`);
      } else {
        await apiPost(endpoint, payload);
        setInfo(`${singular} créé(e).`);
      }
      setDialogOpen(false);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(row: EntityRow) {
    const active = Boolean(row.isActive);
    if (
      !window.confirm(
        active
          ? `Désactiver « ${asString(row.nom)} » ? Les références existantes sont préservées.`
          : `Réactiver « ${asString(row.nom)} » ?`,
      )
    ) {
      return;
    }
    setError(null);
    try {
      await apiPatch(`${endpoint}/${row.id}`, { isActive: !active });
      setInfo(active ? 'Élément désactivé.' : 'Élément réactivé.');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur.');
    }
  }

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <TextField
          label={searchPlaceholder}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(0);
          }}
          className="flex-1"
          size="small"
        />
        <FormControl size="small" className="min-w-40">
          <InputLabel>Statut</InputLabel>
          <Select
            value={status}
            label="Statut"
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(0);
            }}
          >
            <MenuItem value="all">Tous</MenuItem>
            <MenuItem value="active">Actifs</MenuItem>
            <MenuItem value="inactive">Désactivés</MenuItem>
          </Select>
        </FormControl>
        <Button variant="contained" startIcon={<Add />} onClick={openCreate}>
          Nouveau
        </Button>
      </Stack>

      {error ? <Alert severity="error">{error}</Alert> : null}
      {info ? (
        <Alert severity="success" onClose={() => setInfo(null)}>
          {info}
        </Alert>
      ) : null}

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              {columns.map((column) => (
                <TableCell
                  key={column.key}
                  sortDirection={sortKey === column.key ? (sortAsc ? 'asc' : 'desc') : false}
                  onClick={
                    column.sortValue
                      ? () => {
                          if (sortKey === column.key) setSortAsc(!sortAsc);
                          else {
                            setSortKey(column.key);
                            setSortAsc(true);
                          }
                        }
                      : undefined
                  }
                  sx={column.sortValue ? { cursor: 'pointer' } : undefined}
                >
                  {column.label}
                </TableCell>
              ))}
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={columns.length + 1} className="py-6 text-center">
                  <CircularProgress size={24} />
                </TableCell>
              </TableRow>
            ) : sortedRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length + 1} className="py-6 text-center">
                  Aucun élément trouvé. {title} — configurez votre premier élément.
                </TableCell>
              </TableRow>
            ) : (
              sortedRows
                .slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)
                .map((row) => (
                  <TableRow key={String(row.id)}>
                    {columns.map((column) => (
                      <TableCell key={column.key}>
                        {column.render
                          ? column.render(row)
                          : asString(row[column.key])}
                      </TableCell>
                    ))}
                    <TableCell align="right">
                      <Button size="small" onClick={() => openEdit(row)}>
                        Modifier
                      </Button>
                      <Button size="small" onClick={() => toggleActive(row)}>
                        {row.isActive ? 'Désactiver' : 'Réactiver'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
            )}
          </TableBody>
        </Table>
        <TablePagination
          component="div"
          count={sortedRows.length}
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

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {editing ? `Modifier : ${asString(editing.nom)}` : `Nouvel élément — ${title}`}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} className="pt-1">
            {fields.map((field) => (
              <TextField
                key={field.name}
                label={field.label}
                value={form[field.name] ?? ''}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, [field.name]: event.target.value }))
                }
                type={field.type === 'number' ? 'number' : field.type === 'color' ? 'text' : 'text'}
                multiline={field.type === 'textarea'}
                minRows={field.type === 'textarea' ? 3 : undefined}
                required={field.required}
                helperText={field.helper}
                fullWidth
              />
            ))}
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
