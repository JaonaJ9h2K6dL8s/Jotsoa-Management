'use client';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import type { PlanDTO, RevisionDTO, RollDTO, TableDTO } from './api';

/**
 * Barre supérieure : plan, produit/taille/tissu, rouleau, table,
 * Annuler/Rétablir/Zoom/Ajuster/Enregistrer et état du plan.
 */

interface TopBarProps {
  plan: PlanDTO | null;
  revision: RevisionDTO | null;
  roll: RollDTO | null;
  tables: TableDTO[];
  table: TableDTO | null;
  hasUnsaved: boolean;
  canUndo: boolean;
  canRedo: boolean;
  saving: boolean;
  optimizing: boolean;
  onTableChange: (tableId: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  /** Cadrer les pièces placées. */
  onFit: () => void;
  /** Cadrer la table entière. */
  onFitTable: () => void;
  onSave: () => void;
  onOptimize: () => void;
}

export default function TopBar(props: TopBarProps) {
  const {
    plan, revision, roll, tables, table, hasUnsaved, canUndo, canRedo, saving,
    optimizing, onTableChange, onUndo, onRedo, onZoomIn, onZoomOut, onFit,
    onFitTable, onSave, onOptimize,
  } = props;
  const status = plan?.status === 'valide'
    ? 'validé'
    : hasUnsaved
      ? 'modifications non enregistrées'
      : 'brouillon';

  return (
    <Box sx={{
      px: 2, py: 1, bgcolor: 'background.paper', borderBottom: '1px solid',
      borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap',
    }}>
      <Box sx={{ minWidth: 170 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
          Plan de coupe #{plan?.id ?? '—'}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {revision ? `${revision.modelName} · v${revision.version}` : 'aucun patron'}
        </Typography>
      </Box>
      <Box sx={{ minWidth: 150 }}>
        <Typography variant="body2">Taille : {revision ? `#${revision.sizeId}` : '—'}</Typography>
        <Typography variant="caption" color="text.secondary">
          Tissu : {revision?.fabricRef ?? '—'}
        </Typography>
      </Box>
      <Box sx={{ minWidth: 120 }}>
        <Typography variant="body2">Rouleau : {roll?.code ?? '—'}</Typography>
        <Typography variant="caption" color="text.secondary">
          {roll ? `${roll.colorNom ?? 'couleur —'} · ${roll.usableWidthCm ?? roll.widthCm ?? '?'} cm utiles` : ''}
        </Typography>
      </Box>
      <TextField
        select size="small" label="Table" sx={{ minWidth: 140 }}
        value={table ? String(table.id) : ''}
        onChange={(event) => onTableChange(Number(event.target.value))}
      >
        {tables.filter((item) => item.isActive).map((item) => (
          <MenuItem key={item.id} value={item.id}>
            {item.nom} ({item.largeurCm} × {item.longueurMaxCm} cm)
          </MenuItem>
        ))}
      </TextField>
      <Chip
        size="small"
        label={status}
        color={plan?.status === 'valide' ? 'success' : hasUnsaved ? 'warning' : 'default'}
      />
      <Box sx={{ flex: 1 }} />
      <Stack direction="row" spacing={0.5}>
        <Tooltip title="Annuler"><span><Button size="small" disabled={!canUndo || plan?.status === 'valide'} onClick={onUndo}>↶</Button></span></Tooltip>
        <Tooltip title="Rétablir"><span><Button size="small" disabled={!canRedo || plan?.status === 'valide'} onClick={onRedo}>↷</Button></span></Tooltip>
        <Tooltip title="Zoom −"><Button size="small" onClick={onZoomOut}>−</Button></Tooltip>
        <Tooltip title="Zoom +"><Button size="small" onClick={onZoomIn}>+</Button></Tooltip>
        <Tooltip title="Ajuster aux pièces placées"><Button size="small" onClick={onFit}>Ajuster</Button></Tooltip>
        <Tooltip title="Ajuster à la table"><Button size="small" onClick={onFitTable}>Table</Button></Tooltip>
        <Tooltip title="Proposer un placement optimisé (sans écraser le plan courant)">
          <span>
            <Button size="small" variant="outlined" disabled={optimizing || !plan || plan.status === 'valide'} onClick={onOptimize}>
              {optimizing ? 'Optimisation…' : 'Optimiser le placement'}
            </Button>
          </span>
        </Tooltip>
        <Tooltip title="Enregistrer explicitement le plan (le serveur revalide tout)">
          <span>
            <Button size="small" variant="contained" disabled={saving || !plan || plan.status === 'valide'} onClick={onSave}>
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </Button>
          </span>
        </Tooltip>
      </Stack>
    </Box>
  );
}
