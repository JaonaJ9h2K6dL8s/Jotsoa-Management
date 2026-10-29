'use client';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import type { PlanDTO, RevisionDTO, RollDTO, TableDTO } from './api';

/**
 * Étapes 1 à 4 du workflow : sélection du rouleau utilisable, du
 * patron validé (produit + taille), du matelas et des couches, puis
 * création/ouverture du plan. Un plan ne peut être créé qu'avec un
 * rouleau ET un patron validé ET une table sélectionnés.
 */

interface StepSelectorsProps {
  rolls: RollDTO[];
  revisions: RevisionDTO[];
  plans: PlanDTO[];
  rollId: string;
  revisionId: string;
  table: TableDTO | null;
  matelas: string;
  layers: string;
  onRollChange: (value: string) => void;
  onRevisionChange: (value: string) => void;
  onMatelasChange: (value: string) => void;
  onLayersChange: (value: string) => void;
  onCreate: () => void;
  onOpen: (planId: number) => void;
}

export default function StepSelectors(props: StepSelectorsProps) {
  const {
    rolls, revisions, plans, rollId, revisionId, table, matelas, layers,
    onRollChange, onRevisionChange, onMatelasChange, onLayersChange,
    onCreate, onOpen,
  } = props;
  // Les valeurs d'état sont des chaînes : MUI Select renvoie la valeur
  // brute du MenuItem (nombre ici), d'où la conversion explicite.
  const canCreate = Boolean(
    revisions.some((item) => String(item.id) === String(revisionId))
    && rolls.some((item) => String(item.id) === String(rollId)) && table,
  );
  return (
    <Stack
      direction="row" spacing={1} sx={{
        p: 1, alignItems: 'center', flexWrap: 'wrap',
        borderBottom: '1px solid', borderColor: 'divider',
      }}
    >
      <TextField select size="small" label="Rouleau" sx={{ minWidth: 190 }}
        value={rollId}
        onChange={(event) => onRollChange(String(event.target.value))}>
        {rolls.map((item) => (
          <MenuItem key={item.id} value={item.id}>
            {item.code} · {item.colorNom ?? '—'} · {item.lengthM ?? '?'} m
          </MenuItem>
        ))}
      </TextField>
      <TextField select size="small" label="Patron validé" sx={{ minWidth: 230 }}
        value={revisionId}
        onChange={(event) => onRevisionChange(String(event.target.value))}>
        {revisions.map((item) => (
          <MenuItem key={item.id} value={item.id}>
            #{item.id} · {item.modelName} · {item.pieces.length} pièces
          </MenuItem>
        ))}
      </TextField>
      <TextField size="small" type="number" label="Matelas (cm)" sx={{ width: 130 }}
        value={matelas} onChange={(event) => onMatelasChange(event.target.value)} />
      <TextField size="small" type="number" label="Couches" sx={{ width: 100 }}
        value={layers} onChange={(event) => onLayersChange(event.target.value)} />
      <Box>
        <Button variant="contained" size="small" disabled={!canCreate} onClick={onCreate}>
          Nouveau plan
        </Button>
      </Box>
      <TextField select size="small" label="Ouvrir" sx={{ minWidth: 160 }} value=""
        onChange={(event) => { if (event.target.value) onOpen(Number(event.target.value)); }}>
        {plans.slice(0, 20).map((item) => (
          <MenuItem key={item.id} value={item.id}>
            #{item.id} · {item.status === 'valide' ? 'validé' : 'brouillon'}
          </MenuItem>
        ))}
      </TextField>
    </Stack>
  );
}
