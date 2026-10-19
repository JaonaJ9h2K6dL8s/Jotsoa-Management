'use client';

import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { apiPost } from '@/services/api-client';
import type { RollDTO } from '@/types/coupe';
import type { LotWorkflowRow } from '@/server/coupe/lot-workflow';
import type { MarkerPlanRow } from '@/server/coupe/marker';

/**
 * Préparation automatique du matelas : le système propose la table, la
 * longueur et le nombre de couches à partir du rouleau choisi ; le
 * responsable peut ajuster les propositions avant de générer le plan
 * de placement.
 */

interface MatelasProposal {
  tableId: number | null;
  tableNom: string | null;
  matelasLengthCm: number;
  layers: number;
  usableWidthCm: number;
  reason: string;
}

interface CoupeTableOption {
  id: number;
  nom: string;
  largeurCm: number;
  longueurMaxCm: number;
  largeurUtileCm: number;
  couchesMax: number;
}

export default function LotMatelasDialog({
  open,
  onClose,
  lot,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  lot: LotWorkflowRow;
  onDone: () => void;
}) {
  const [rolls, setRolls] = useState<RollDTO[]>([]);
  const [tables, setTables] = useState<CoupeTableOption[]>([]);
  const [rollId, setRollId] = useState('');
  const [tableId, setTableId] = useState('');
  const [proposal, setProposal] = useState<MatelasProposal | null>(null);
  const [length, setLength] = useState('');
  const [layers, setLayers] = useState('');
  const [width, setWidth] = useState('');
  const [grammage, setGrammage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setProposal(null);
    setError(null);
    setRollId('');
    setTableId('');
    void (async () => {
      try {
        const [rollsBody, tablesBody] = await Promise.all([
          fetch('/api/coupe/rolls?status=disponible', {
            headers: { Accept: 'application/json' },
            cache: 'no-store',
          }).then((response) => response.json()),
          fetch('/api/coupe/tables', {
            headers: { Accept: 'application/json' },
            cache: 'no-store',
          }).then((response) => response.json()),
        ]);
        setRolls((rollsBody.items ?? []) as RollDTO[]);
        setTables((tablesBody.items ?? []) as CoupeTableOption[]);
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : 'Erreur de chargement.',
        );
      }
    })();
  }, [open]);

  const selectedRoll = rolls.find((roll) => String(roll.id) === rollId);

  async function propose() {
    setBusy(true);
    setError(null);
    try {
      const body = await apiPost<{ item: MatelasProposal }>(
        `/api/coupe/lots/${lot.id}/workflow`,
        {
          action: 'propose_matelas',
          rollId: Number(rollId),
          coupeTableId: tableId ? Number(tableId) : null,
        },
      );
      const item = body.item;
      setProposal(item);
      setLength(String(item.matelasLengthCm));
      setLayers(String(item.layers));
      setWidth(String(item.usableWidthCm));
      setGrammage(
        selectedRoll?.grammageGm2 != null ? String(selectedRoll.grammageGm2) : '',
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Échec de la proposition.');
    } finally {
      setBusy(false);
    }
  }

  async function generatePlan() {
    setBusy(true);
    setError(null);
    try {
      await apiPost<{ item: MarkerPlanRow }>(
        `/api/coupe/lots/${lot.id}/workflow`,
        {
          action: 'generate_plan',
          rollId: Number(rollId),
          usableWidthCm: Number(width),
          matelasLengthCm: Number(length),
          layers: Number(layers),
          grammageGm2: grammage ? Number(grammage) : undefined,
          coupeTableId: proposal?.tableId ?? (tableId ? Number(tableId) : null),
        },
      );
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Échec de la génération.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>
        Préparer le matelas — lot {lot.code}
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <FormControl size="small" fullWidth>
            <InputLabel>Rouleau de tissu</InputLabel>
            <Select
              label="Rouleau de tissu"
              value={rollId}
              onChange={(event) => setRollId(event.target.value)}
            >
              {rolls.map((roll) => (
                <MenuItem key={roll.id} value={roll.id}>
                  {roll.code} — {roll.fabricRef}
                  {roll.colorNom ? ` (${roll.colorNom})` : ''}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" fullWidth>
            <InputLabel>Table de coupe (optionnel)</InputLabel>
            <Select
              label="Table de coupe (optionnel)"
              value={tableId}
              onChange={(event) => setTableId(event.target.value)}
            >
              <MenuItem value="">Proposition automatique</MenuItem>
              {tables.map((table) => (
                <MenuItem key={table.id} value={table.id}>
                  {table.nom} ({table.largeurUtileCm} cm × {table.longueurMaxCm} cm,
                  {' '}{table.couchesMax} couches max)
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Button
            variant="outlined"
            disabled={!rollId || busy}
            onClick={() => void propose()}
          >
            Proposer la configuration
          </Button>
          {proposal ? (
            <>
              <Alert severity="info">{proposal.reason}</Alert>
              <Typography variant="caption" color="text.secondary">
                Les valeurs ci-dessous sont des propositions ajustables.
              </Typography>
              <Stack direction="row" spacing={2}>
                <TextField
                  size="small"
                  fullWidth
                  type="number"
                  label="Longueur matelas (cm)"
                  value={length}
                  onChange={(event) => setLength(event.target.value)}
                />
                <TextField
                  size="small"
                  fullWidth
                  type="number"
                  label="Couches"
                  value={layers}
                  onChange={(event) => setLayers(event.target.value)}
                />
              </Stack>
              <Stack direction="row" spacing={2}>
                <TextField
                  size="small"
                  fullWidth
                  type="number"
                  label="Largeur utile (cm)"
                  value={width}
                  onChange={(event) => setWidth(event.target.value)}
                />
                <TextField
                  size="small"
                  fullWidth
                  type="number"
                  label="Grammage (g/m²)"
                  value={grammage}
                  onChange={(event) => setGrammage(event.target.value)}
                />
              </Stack>
            </>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Fermer</Button>
        <Button
          variant="contained"
          disabled={!proposal || busy}
          onClick={() => void generatePlan()}
        >
          Générer le plan
        </Button>
      </DialogActions>
    </Dialog>
  );
}
