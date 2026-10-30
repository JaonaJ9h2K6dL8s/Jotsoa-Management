'use client';

import { useState } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import UndoIcon from '@mui/icons-material/Undo';
import RedoIcon from '@mui/icons-material/Redo';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import CenterFocusStrongIcon from '@mui/icons-material/CenterFocusStrong';
import CropFreeIcon from '@mui/icons-material/CropFree';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import SaveIcon from '@mui/icons-material/Save';
import NoteAddIcon from '@mui/icons-material/NoteAdd';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import TableChartIcon from '@mui/icons-material/TableChart';
import LayersIcon from '@mui/icons-material/Layers';
import StraightenIcon from '@mui/icons-material/Straighten';
import CheckroomIcon from '@mui/icons-material/Checkroom';
import AutoAwesomeMotionIcon from '@mui/icons-material/AutoAwesomeMotion';
import type { ElementType, ReactNode } from 'react';
import type { PlanDTO, RevisionDTO, RollDTO, TableDTO } from './api';

/**
 * Barre d'outils 100 % icônes façon Illustrator : chaque commande est un
 * bouton icône + micro-légende ; les listes (table, rouleau, patron,
 * ouverture de plan) s'ouvrent en menu déroulant. La barre tient sur
 * UNE ligne étroite — l'espace libéré revient au canvas.
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
  rolls: RollDTO[];
  revisions: RevisionDTO[];
  plans: PlanDTO[];
  rollId: string;
  revisionId: string;
  matelas: string;
  layers: string;
  onRollChange: (value: string) => void;
  onRevisionChange: (value: string) => void;
  onMatelasChange: (value: string) => void;
  onLayersChange: (value: string) => void;
  onCreate: () => void;
  onOpen: (planId: number) => void;
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
  autofilling: boolean;
  onAutofill: () => void;
  children?: ReactNode;
}

/** Bouton icône + micro-légende ouvrant un menu déroulant. */
function IconSelect({
  icon: Icon, caption, tooltip, children,
}: {
  icon: ElementType;
  caption: string;
  tooltip: string;
  children: ReactNode;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <Tooltip title={tooltip}>
        <Box
          component="button"
          onClick={(event) => setAnchor(event.currentTarget)}
          sx={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            gap: 0, minWidth: 58, px: 0.5, py: 0.25, cursor: 'pointer',
            bgcolor: 'transparent', border: '1px solid transparent',
            borderRadius: 1, maxWidth: 96,
            '&:hover': { bgcolor: 'rgba(15,122,77,0.08)' },
          }}
        >
          <Icon sx={{ fontSize: 18, color: 'text.primary' }} />
          <Typography sx={{ fontSize: 9, lineHeight: 1.2, maxWidth: 88 }} noWrap color="text.secondary">
            {caption}
          </Typography>
        </Box>
      </Tooltip>
      <Menu anchorEl={anchor} open={anchor !== null} onClose={() => setAnchor(null)}>
        {children}
      </Menu>
    </>
  );
}

/** Champ numérique micro (icône + saisie) pour matelas/couches. */
function MicroNumber({
  icon: Icon, value, onChange, tooltip, width,
}: {
  icon: ElementType;
  value: string;
  onChange: (value: string) => void;
  tooltip: string;
  width: number;
}) {
  return (
    <Tooltip title={tooltip}>
      <TextField
        size="small"
        type="number"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        sx={{
          width,
          '& .MuiInputBase-root': { pl: 0.25 },
          '& .MuiInputBase-input': { px: 0.5, fontSize: 12, py: 0.5 },
        }}
        InputProps={{
          startAdornment: <Icon sx={{ fontSize: 15, mr: 0.25, color: 'text.secondary' }} />,
        }}
      />
    </Tooltip>
  );
}

export default function TopBar(props: TopBarProps) {
  const {
    plan, revision, roll, tables, table, hasUnsaved, canUndo, canRedo, saving,
    optimizing, rolls, revisions, plans, rollId, revisionId, matelas, layers,
    onRollChange, onRevisionChange, onMatelasChange, onLayersChange,
    onCreate, onOpen, onTableChange, onUndo, onRedo, onZoomIn, onZoomOut,
    onFit, onFitTable, onSave, onOptimize,
    autofilling, onAutofill, children,
  } = props;
  const status = plan?.status === 'valide'
    ? 'validé'
    : hasUnsaved
      ? 'modifié'
      : 'brouillon';
  const locked = plan?.status === 'valide';

  return (
    <Box sx={{
      px: 1, py: 0.25, bgcolor: 'background.paper', borderBottom: '1px solid',
      borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 0.5,
      flexWrap: 'nowrap', overflowX: 'auto', overflowY: 'hidden', flexShrink: 0,
      '&::-webkit-scrollbar': { height: 5 },
      '&::-webkit-scrollbar-thumb': { bgcolor: 'rgba(30,36,48,0.18)', borderRadius: 3 },
    }}>
      <Box sx={{ minWidth: 96, maxWidth: 150, px: 0.5 }}>
        <Typography variant="body2" sx={{ fontWeight: 700, lineHeight: 1.1, whiteSpace: 'nowrap', fontSize: 13 }}>
          Plan #{plan?.id ?? '—'}
          {revision ? ` · ${revision.modelName}` : ''}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap', fontSize: 10 }}>
          {revision ? `v${revision.version} · ` : ''}{roll?.code ?? 'sans rouleau'}
        </Typography>
      </Box>
      <Chip
        size="small"
        label={status}
        color={locked ? 'success' : hasUnsaved ? 'warning' : 'default'}
        sx={{ height: 20, '& .MuiChip-label': { fontSize: 10 } }}
      />

      <IconSelect icon={TableChartIcon}
        caption={table ? table.nom : 'Table'}
        tooltip={`Table de coupe${table ? ` — ${table.nom} (${table.largeurCm} × ${table.longueurMaxCm} cm)` : ''}`}>
        {tables.filter((item) => item.isActive).map((item) => (
          <MenuItem key={item.id} selected={table?.id === item.id}
            onClick={() => onTableChange(item.id)}>
            {item.nom} ({item.largeurCm} × {item.longueurMaxCm} cm)
          </MenuItem>
        ))}
      </IconSelect>

      <IconSelect icon={LayersIcon}
        caption={roll ? `${roll.code} · ${roll.colorNom ?? '—'}` : 'Rouleau'}
        tooltip="Rouleau de tissu">
        {rolls.map((item) => (
          <MenuItem key={item.id} selected={String(item.id) === String(rollId)}
            onClick={() => onRollChange(String(item.id))}>
            {item.code} · {item.colorNom ?? '—'} · {item.lengthM ?? '?'} m
          </MenuItem>
        ))}
      </IconSelect>

      <IconSelect icon={CheckroomIcon}
        caption={revision ? `#${revision.id} ${revision.modelName}` : 'Patron'}
        tooltip="Patron validé (produit + taille)">
        {revisions.map((item) => (
          <MenuItem key={item.id} selected={String(item.id) === String(revisionId)}
            onClick={() => onRevisionChange(String(item.id))}>
            #{item.id} · {item.modelName} · {item.pieces.length} pièces
          </MenuItem>
        ))}
      </IconSelect>

      <MicroNumber icon={StraightenIcon} value={matelas} onChange={onMatelasChange}
        tooltip="Longueur du matelas (cm)" width={76} />
      <MicroNumber icon={LayersIcon} value={layers} onChange={onLayersChange}
        tooltip="Nombre de couches" width={64} />
      <Tooltip
        title={'Calcul automatique : remplit le matelas de jeux complets du '
          + 'patron, borne le nombre de matelas par le stock du rouleau '
          + '(métrage, grammage, couches), puis duplique les matelas.'}>
        <span>
          <IconButton size="small" disabled={autofilling || !plan || locked} onClick={onAutofill}
            sx={{ p: 0.5, border: '1px solid', borderColor: 'divider', borderRadius: 1,
              color: 'primary.main', '&:hover': { bgcolor: 'rgba(15,122,77,0.08)' } }}>
            <AutoAwesomeMotionIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </span>
      </Tooltip>

      <Tooltip title="Créer un nouveau plan (rouleau + patron + table requis)">
        <span>
          <IconButton size="small" disabled={
            !revisions.some((item) => String(item.id) === String(revisionId))
            && !rolls.some((item) => String(item.id) === String(rollId))
          } onClick={onCreate} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
            <NoteAddIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </span>
      </Tooltip>

      <IconSelect icon={FolderOpenIcon} caption="Ouvrir" tooltip="Ouvrir un plan existant">
        {plans.slice(0, 20).map((item) => (
          <MenuItem key={item.id} onClick={() => onOpen(item.id)}>
            #{item.id} · {item.status === 'valide' ? 'validé' : 'brouillon'}
          </MenuItem>
        ))}
      </IconSelect>

      {children}

      <Box sx={{ flex: 1 }} />

      <Stack direction="row" spacing={0.25} sx={{ alignItems: 'center' }}>
        <Tooltip title="Annuler"><span>
          <IconButton size="small" disabled={!canUndo || locked} onClick={onUndo} sx={{ p: 0.5 }}>
            <UndoIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </span></Tooltip>
        <Tooltip title="Rétablir"><span>
          <IconButton size="small" disabled={!canRedo || locked} onClick={onRedo} sx={{ p: 0.5 }}>
            <RedoIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </span></Tooltip>
        <Tooltip title="Zoom −">
          <IconButton size="small" onClick={onZoomOut} sx={{ p: 0.5 }}>
            <ZoomOutIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
        <Tooltip title="Zoom +">
          <IconButton size="small" onClick={onZoomIn} sx={{ p: 0.5 }}>
            <ZoomInIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
        <Tooltip title="Ajuster aux pièces placées">
          <IconButton size="small" onClick={onFit} sx={{ p: 0.5 }}>
            <CenterFocusStrongIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
        <Tooltip title="Ajuster à la table">
          <IconButton size="small" onClick={onFitTable} sx={{ p: 0.5 }}>
            <CropFreeIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
        <Tooltip title="Optimiser le placement (proposition, sans écraser le plan)">
          <span>
            <IconButton size="small" disabled={optimizing || !plan || locked} onClick={onOptimize}
              sx={{ p: 0.5, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
              <AutoFixHighIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Enregistrer le plan (le serveur revalide tout)">
          <span>
            <IconButton size="small" disabled={saving || !plan || locked} onClick={onSave}
              sx={{ p: 0.5, bgcolor: 'primary.main', color: '#fff', borderRadius: 1,
                '&:hover': { bgcolor: 'primary.dark' } }}>
              <SaveIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>
    </Box>
  );
}
