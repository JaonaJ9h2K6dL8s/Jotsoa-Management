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
import { useEffect, useState } from 'react';
import { apiPost } from '@/services/api-client';
import ProductSelect from '@/components/common/product-select';
import { ROLL_STATUS_LABELS, type RollDTO, type RollStatus } from '@/types/coupe';
import { useCoupeData } from './use-coupe';
import RollDetailDialog from './roll-detail-dialog';

interface ReferenceOption {
  id: number;
  nom: string;
}

const EMPTY_FORM = {
  code: '',
  fabricRef: '',
  colorId: '',
  initialWeightKg: '',
  initialQty: '',
  qtyUnit: '',
  supplier: '',
  observations: '',
};

/** Gestion des rouleaux : liste filtrable, création (poids 9–30 kg) et fiche. */
export default function RollsManager() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const query = `/api/coupe/rolls?search=${encodeURIComponent(search)}&status=${status === 'all' ? '' : status}`;
  const { data, loading, error, refresh, setError } = useCoupeData<RollDTO[]>(query);
  const references = useCoupeData<{ products: ReferenceOption[]; colors: ReferenceOption[]; sizes: ReferenceOption[] }>(
    '/api/coupe/references',
  );
  const [openCreate, setOpenCreate] = useState(false);
  const [fabricProductId, setFabricProductId] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  useEffect(() => {
    setPage(0);
  }, [search, status]);

  const rolls = data ?? [];

  async function handleCreate() {
    setSaving(true);
    setError(null);
    try {
      await apiPost('/api/coupe/rolls', {
        ...form,
        colorId: form.colorId || undefined,
        initialQty: form.initialQty || undefined,
      });
      setInfo('Rouleau créé avec succès.');
      setOpenCreate(false);
      setForm(EMPTY_FORM);
      setFabricProductId('');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erreur.');
    } finally {
      setSaving(false);
    }
  }

  function handleDetailClosed() {
    setSelectedId(null);
    void refresh();
  }

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <TextField
          label="Rechercher un code ou un tissu…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="flex-1"
          size="small"
        />
        <FormControl size="small" className="min-w-40">
          <InputLabel>Statut</InputLabel>
          <Select
            value={status}
            label="Statut"
            onChange={(event) => setStatus(event.target.value)}
          >
            <MenuItem value="all">Tous</MenuItem>
            {Object.entries(ROLL_STATUS_LABELS).map(([value, label]) => (
              <MenuItem key={value} value={value}>
                {label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Button variant="contained" startIcon={<Add />} onClick={() => setOpenCreate(true)}>
          Nouveau rouleau
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
              <TableCell>Code</TableCell>
              <TableCell>Tissu</TableCell>
              <TableCell>Couleur</TableCell>
              <TableCell align="right">Poids initial</TableCell>
              <TableCell align="right">Poids restant</TableCell>
              <TableCell>Statut</TableCell>
              <TableCell align="right">Fiche</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="py-6 text-center">
                  <CircularProgress size={24} />
                </TableCell>
              </TableRow>
            ) : rolls.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-6 text-center">
                  Aucun rouleau enregistré. Créez votre premier rouleau.
                </TableCell>
              </TableRow>
            ) : (
              rolls
                .slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)
                .map((roll) => (
                  <TableRow key={roll.id} hover>
                    <TableCell>{roll.code}</TableCell>
                    <TableCell>{roll.fabricRef}</TableCell>
                    <TableCell>{roll.colorNom ?? '—'}</TableCell>
                    <TableCell align="right">{roll.initialWeightKg} kg</TableCell>
                    <TableCell align="right">
                      {roll.remainingWeightKg === null ? '—' : `${roll.remainingWeightKg} kg`}
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={ROLL_STATUS_LABELS[roll.status as RollStatus] ?? roll.status}
                        color={roll.status === 'disponible' ? 'success' : roll.status === 'bloque' || roll.status === 'defectueux' ? 'error' : 'default'}
                      />
                    </TableCell>
                    <TableCell align="right">
                      <Button size="small" onClick={() => setSelectedId(roll.id)}>
                        Ouvrir
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
            )}
          </TableBody>
        </Table>
        <TablePagination
          component="div"
          count={rolls.length}
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

      <RollDetailDialog
        rollId={selectedId}
        onClose={handleDetailClosed}
      />

      <Dialog open={openCreate} onClose={() => setOpenCreate(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Nouveau rouleau de tissu</DialogTitle>
        <DialogContent>
          <Stack spacing={2} className="pt-1">
            <TextField
              label="Code manuel (facultatif — généré sinon)"
              value={form.code}
              onChange={(event) => setForm({ ...form, code: event.target.value })}
              helperText="Lettres, chiffres, tirets. Unique parmi les rouleaux."
            />
            <ProductSelect
              label="Matière première (tissu)"
              value={fabricProductId}
              onChange={(_id, nom) => {
                setFabricProductId(_id);
                setForm((current) => ({ ...current, fabricRef: nom }));
              }}
              restrictToTypeName="Matières premières"
              required
            />
            <FormControl size="small">
              <InputLabel>Couleur (facultatif)</InputLabel>
              <Select
                value={form.colorId}
                label="Couleur (facultatif)"
                onChange={(event) => setForm({ ...form, colorId: event.target.value })}
              >
                <MenuItem value="">— Aucune —</MenuItem>
                {(references.data?.colors ?? []).map((color) => (
                  <MenuItem key={color.id} value={color.id}>
                    {color.nom}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              label="Poids initial (kg)"
              required
              type="number"
              inputProps={{ step: '0.01', min: 9, max: 30 }}
              value={form.initialWeightKg}
              onChange={(event) => setForm({ ...form, initialWeightKg: event.target.value })}
              helperText="Obligatoire entre 9 et 30 kg inclus. Vérifié côté serveur."
              error={
                form.initialWeightKg !== '' &&
                (Number(form.initialWeightKg.replace(',', '.')) < 9 ||
                  Number(form.initialWeightKg.replace(',', '.')) > 30)
              }
            />
            <Stack direction="row" spacing={2}>
              <TextField
                label="Quantité initiale (facultatif)"
                type="number"
                value={form.initialQty}
                onChange={(event) => setForm({ ...form, initialQty: event.target.value })}
                className="flex-1"
              />
              <TextField
                label="Unité"
                value={form.qtyUnit}
                onChange={(event) => setForm({ ...form, qtyUnit: event.target.value })}
                className="w-32"
              />
            </Stack>
            <TextField
              label="Fournisseur (facultatif)"
              value={form.supplier}
              onChange={(event) => setForm({ ...form, supplier: event.target.value })}
            />
            <TextField
              label="Observations"
              multiline
              minRows={2}
              value={form.observations}
              onChange={(event) => setForm({ ...form, observations: event.target.value })}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenCreate(false)} disabled={saving}>
            Annuler
          </Button>
          <Button onClick={handleCreate} variant="contained" disabled={saving}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
