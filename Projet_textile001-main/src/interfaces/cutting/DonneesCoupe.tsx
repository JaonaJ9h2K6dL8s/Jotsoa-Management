'use client';

import { useCallback, useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Snackbar from '@mui/material/Snackbar';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import {
  atelierAction, loadWorkspace,
  type CatalogueDTO, type RollDetailDTO, type RollDTO, type WorkspaceData,
} from './api';
import DonneesProduits from './DonneesProduits';
import PanelTransfers from './PanelTransfers';
import RollOpsDialogs, { type RollOpsMode } from './RollOpsDialogs';

/**
 * Gestion des données d'entrée de l'atelier Coupe (chef de coupe) :
 * création et modification des ROULEAUX (référence, couleur, longueur,
 * largeur utile, grammage — le poids physique n'est pas modifiable) et
 * des PRODUITS du catalogue (famille couverte par les règles de
 * patronage, catégorie, tailles). L'atelier appelle ensuite simplement
 * ces rouleaux et produits stockés via ses listes déroulantes.
 */

const FAMILIES = [
  { value: 'tshirt', label: 'T-shirt' },
  { value: 'polo', label: 'Polo' },
  { value: 'short', label: 'Short' },
  { value: 'jogging', label: 'Jogging' },
  { value: 'ensemble', label: 'Ensemble' },
];

interface RollForm {
  rollId: number | null;
  code: string;
  fabricRef: string;
  colorId: string;
  weightKg: string;
  lengthM: string;
  widthCm: string;
  usableWidthCm: string;
  grammageGm2: string;
}

const EMPTY_ROLL: RollForm = {
  rollId: null, code: '', fabricRef: '', colorId: '', weightKg: '',
  lengthM: '', widthCm: '180', usableWidthCm: '170', grammageGm2: '',
};

export default function DonneesCoupe() {
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [rollForm, setRollForm] = useState<RollForm | null>(null);
  const [opsMode, setOpsMode] = useState<RollOpsMode>(null);
  const [opsStatusTarget, setOpsStatusTarget] = useState<'bloque' | 'defectueux' | 'disponible'>('bloque');
  const [opsRoll, setOpsRoll] = useState<RollDetailDTO | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const workspace = await loadWorkspace();
      setData(workspace);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Erreur de chargement.');
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const patchRoll = (patch: Partial<RollForm>) => {
    setRollForm((current) => (current ? { ...current, ...patch } : current));
  };

  const openRoll = (roll: RollDTO | null) => {
    setRollForm(roll ? {
      rollId: roll.id, code: roll.code, fabricRef: roll.fabricRef,
      colorId: roll.colorNom ?? '', weightKg: String(roll.weightKg),
      lengthM: roll.lengthM !== null ? String(roll.lengthM) : '',
      widthCm: roll.widthCm !== null ? String(roll.widthCm) : '',
      usableWidthCm: roll.usableWidthCm !== null ? String(roll.usableWidthCm) : '',
      grammageGm2: roll.grammageGm2 !== null ? String(roll.grammageGm2) : '',
    } : { ...EMPTY_ROLL });
  };

  const openOps = (
    mode: Exclude<RollOpsMode, null>,
    roll: RollDetailDTO,
    statusTarget?: 'bloque' | 'defectueux' | 'disponible',
  ) => {
    if (statusTarget) setOpsStatusTarget(statusTarget);
    setOpsRoll(roll);
    setOpsMode(mode);
  };

  const saveRoll = async () => {
    if (!rollForm) return;
    setBusy(true);
    try {
      const color = data?.colors.find((item) => item.nom === rollForm.colorId);
      const payload = {
        fabricRef: rollForm.fabricRef,
        colorId: color ? color.id : null,
        lengthM: rollForm.lengthM,
        widthCm: rollForm.widthCm,
        usableWidthCm: rollForm.usableWidthCm,
        grammageGm2: rollForm.grammageGm2,
      };
      if (rollForm.rollId === null) {
        await atelierAction<RollDTO>('roll.create', { ...payload, code: rollForm.code, weightKg: rollForm.weightKg });
        setToast(`Rouleau ${rollForm.code} créé.`);
      } else {
        await atelierAction<RollDTO>('roll.update', { ...payload, rollId: rollForm.rollId });
        setToast(`Rouleau ${rollForm.code} mis à jour.`);
      }
      setRollForm(null);
      await reload();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Erreur d’enregistrement.');
    } finally {
      setBusy(false);
    }
  };

  if (error && !data) {
    return <Alert severity="error" sx={{ m: 3 }}>{error}</Alert>;
  }
  if (!data) return <Typography sx={{ m: 3 }}>Chargement…</Typography>;

  return (
    <Box sx={{ p: 3, maxWidth: 1100, mx: 'auto' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h5">Données de l’atelier Coupe</Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <PanelTransfers />
          <Button variant="contained" onClick={() => openRoll(null)}>Nouveau rouleau</Button>
        </Box>
      </Box>
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      <Typography variant="h6" sx={{ mt: 1, mb: 1 }}>
        Rouleaux ({(data.rollsAll ?? []).length})
      </Typography>
      <Alert severity="info" sx={{ mb: 1, py: 0.5 }}>
        Consommation physique confirmée (kg, mouvements) distincte de la
        longueur calculée à partir des placements. Aucune valeur n’est
        inventée : « inconnu » signifie donnée absente. Un rouleau bloqué,
        épuisé ou défectueux ne peut pas être affecté à une nouvelle coupe.
      </Alert>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Code</TableCell><TableCell>Tissu</TableCell>
              <TableCell>Couleur</TableCell><TableCell>État</TableCell>
              <TableCell>Poids init./restant (kg)</TableCell>
              <TableCell>Longueur init./consommée/restante (m)</TableCell>
              <TableCell>Largeur / utile (cm)</TableCell>
              <TableCell>Grammage</TableCell>
              <TableCell>Créé par / le</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {(data.rollsAll ?? []).map((roll) => (
              <TableRow key={roll.id}>
                <TableCell>{roll.code}</TableCell>
                <TableCell>{roll.fabricRef}</TableCell>
                <TableCell>{roll.colorNom ?? '—'}</TableCell>
                <TableCell>
                  <Chip size="small" label={roll.status} color={
                    roll.status === 'disponible' ? 'success'
                      : roll.status === 'en_utilisation' ? 'primary'
                        : roll.status === 'epuise' ? 'default' : 'warning'
                  } />
                </TableCell>
                <TableCell>
                  {roll.weightKg.toFixed(1)} / {roll.remainingWeightKg ?? 'inconnu'}
                </TableCell>
                <TableCell>
                  {roll.lengthM ?? '—'} / {roll.consumedM ?? '—'} / {roll.remainingM ?? 'inconnue'}
                </TableCell>
                <TableCell>{roll.widthCm ?? '—'} / {roll.usableWidthCm ?? '—'}</TableCell>
                <TableCell>{roll.grammageGm2 ?? '—'}</TableCell>
                <TableCell>
                  {roll.responsable ?? '—'} · {roll.createdAt.slice(0, 10)}
                </TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>
                  {roll.alerts.length > 0 && (
                    <Chip size="small" color="warning"
                      label={`${roll.alerts.length} alerte(s)`}
                      title={roll.alerts.map((alert) => alert.message).join('\n')} />
                  )}
                  {roll.status === 'disponible' && (
                    <Button size="small" onClick={() => openRoll(roll)}>Modifier</Button>
                  )}
                  <Button size="small" onClick={() => openOps('adjust', roll)}>Corriger</Button>
                  {roll.status === 'disponible' && (
                    <Button size="small" onClick={() => openOps('status', roll, 'bloque')}>Bloquer</Button>
                  )}
                  {(roll.status === 'bloque' || roll.status === 'defectueux') && (
                    <Button size="small" onClick={() => openOps('status', roll, 'disponible')}>Débloquer</Button>
                  )}
                  <Button size="small" onClick={() => openOps('history', roll)}>Historique</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <DonneesProduits
        products={data.catalogue}
        sizes={data.sizes}
        familyRules={data.familyRules ?? []}
        fiches={data.fiches}
        revisions={data.revisions}
        canValidateFiche={data.canValidatePlan}
        onChanged={reload}
        onToast={setToast}
        onError={setError}
      />

      <RollOpsDialogs
        mode={opsMode}
        statusTarget={opsStatusTarget}
        roll={opsRoll}
        onClose={() => setOpsMode(null)}
        onChanged={reload}
        onToast={setToast}
        onError={setError}
      />

      <Dialog open={rollForm !== null} onClose={() => setRollForm(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{rollForm?.rollId === null ? 'Nouveau rouleau' : 'Modifier le rouleau'}</DialogTitle>
        <DialogContent sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, pt: 1 }}>
          <Alert severity="info" sx={{ gridColumn: '1 / -1', py: 0.5 }}>
            Le poids et la longueur déclarés doivent correspondre au
            grammage et à la largeur : longueur (m) ≈ poids (kg) × 1000 ÷
            (grammage × largeur en m). Au-delà de 10 % d&apos;écart,
            l&apos;enregistrement est refusé. La largeur NOMINALE sert au calcul
            du poids déroulé ; la largeur utile reste réservée au placement
            des patrons. Laisser la longueur vide = rouleau suivi en kg
            uniquement (métrage inconnu, jamais inventé).
          </Alert>
          <TextField label="Code" value={rollForm?.code ?? ''} disabled={rollForm?.rollId !== null}
            onChange={(event) => patchRoll({ code: event.target.value })} />
          <TextField label="Poids (kg, 9–30, non modifiable)" value={rollForm?.weightKg ?? ''}
            disabled={rollForm?.rollId !== null}
            onChange={(event) => patchRoll({ weightKg: event.target.value })} />
          <TextField label="Référence tissu" value={rollForm?.fabricRef ?? ''}
            onChange={(event) => patchRoll({ fabricRef: event.target.value })} />
          <FormControl size="small">
            <InputLabel>Couleur</InputLabel>
            <Select label="Couleur" value={rollForm?.colorId ?? ''}
              onChange={(event) => patchRoll({ colorId: event.target.value })}>
              <MenuItem value="">—</MenuItem>
              {data.colors.map((color) => (
                <MenuItem key={color.id} value={color.nom}>{color.nom}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField label="Longueur disponible (m, vide = suivi kg seul)"
            value={rollForm?.lengthM ?? ''}
            onChange={(event) => patchRoll({ lengthM: event.target.value })} />
          <TextField label="Largeur tissu (cm)" value={rollForm?.widthCm ?? ''}
            onChange={(event) => patchRoll({ widthCm: event.target.value })} />
          <TextField label="Largeur utile (cm)" value={rollForm?.usableWidthCm ?? ''}
            onChange={(event) => patchRoll({ usableWidthCm: event.target.value })} />
          <TextField label="Grammage (g/m²)" value={rollForm?.grammageGm2 ?? ''}
            onChange={(event) => patchRoll({ grammageGm2: event.target.value })} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRollForm(null)}>Annuler</Button>
          <Button variant="contained" disabled={busy} onClick={() => { void saveRoll(); }}>
            Enregistrer
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={toast !== null} autoHideDuration={4000} onClose={() => setToast(null)}
        message={toast ?? ''} />
    </Box>
  );
}
