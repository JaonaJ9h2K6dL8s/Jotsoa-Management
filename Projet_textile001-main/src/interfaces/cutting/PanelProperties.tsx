'use client';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { PieceDTO, RevisionDTO } from './api';
import type { UIPiece } from './canvas/frame';
import { polygonAreaCm2, uiPieceExtent } from './canvas/frame';

/**
 * Panneau de propriétés : pièce sélectionnée (nom, patron/version,
 * dimensions réelles, X/Y en cm modifiables, rotation parmi les
 * angles autorisés seulement, droit-fil, état de validation, motif
 * d'erreur), et synthèse du plan (état, efficacité, surface).
 */

interface PanelPropertiesProps {
  revision: RevisionDTO | null;
  selection: UIPiece[];
  violations: Map<string, string>;
  planStatus: 'proposition' | 'valide';
  efficiency: number;
  onMove: (key: string, x: number, y: number, commit: boolean) => void;
  onRotate: (key: string, rotation: number, commit: boolean) => void;
  onDelete: (key: string) => void;
  onDuplicate: (key: string) => void;
}

const GRAIN_LABELS: Record<string, string> = {
  along: 'Droit-fil (sens longueur) — rotations limitées',
  cross: 'Droit-trame (sens travers) — rotations limitées',
  any: 'Sans contrainte de droit-fil',
};

export default function PanelProperties(props: PanelPropertiesProps) {
  const { revision, selection, violations, planStatus, efficiency, onMove, onRotate, onDelete, onDuplicate } = props;
  const piece = selection[0];
  const definition: PieceDTO | null = piece
    ? revision?.pieces.find((item) => item.id === piece.pieceId) ?? null
    : null;
  const error = piece ? violations.get(piece.key) : undefined;
  const extent = definition ? uiPieceExtent(definition, piece.rotation) : null;
  const lockAll = planStatus === 'valide';
  // Surface exacte du contour (lacet) — informationnelle : le taux
  // d'utilisation fait foi (calcul serveur sur les contours enregistrés).
  const surfaceCm2 = definition ? polygonAreaCm2(definition.points) : null;
  const productionOk = definition !== null && definition.status === 'configuree'
    && revision?.status === 'valide';

  return (
    <Box sx={{
      width: 280, flexShrink: 0, bgcolor: 'background.paper',
      borderLeft: '1px solid', borderColor: 'divider',
      p: 2, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1.5,
    }}>
      <Typography variant="subtitle2">Propriétés</Typography>
      {!piece && (
        <Typography variant="body2" color="text.secondary">
          Sélectionnez une pièce sur la table pour afficher ses propriétés.
        </Typography>
      )}
      {piece && definition && (
        <>
          <TextField size="small" label="Pièce" value={`${definition.label} (#${definition.id})`} slotProps={{ input: { readOnly: true } }} />
          <TextField size="small" label="Patron / version" value={`${revision?.modelName ?? '—'} · v${revision?.version ?? '—'}`} slotProps={{ input: { readOnly: true } }} />
          <TextField size="small" label="Dimensions (cm)" value={`${definition.widthCm.toFixed(0)} × ${definition.heightCm.toFixed(0)}`} slotProps={{ input: { readOnly: true } }} />
          <TextField size="small" label="Surface du contour (cm²)"
            value={surfaceCm2 !== null ? surfaceCm2.toFixed(0) : '—'}
            slotProps={{ input: { readOnly: true } }} />
          <TextField size="small" label="Marges de couture"
            value={definition.seamIncluded
              ? `incluses (${definition.seamAllowanceCm} cm) — aucune marge à ajouter`
              : `${definition.seamAllowanceCm} cm à ajouter au tracé`}
            slotProps={{ input: { readOnly: true } }} />
          <Typography variant="body2" sx={{
            fontWeight: 600,
            color: productionOk ? 'success.main' : 'error.main',
          }}>
            {productionOk ? 'Validée pour la production' : 'Non validé pour la production'}
          </Typography>
          {!productionOk && (
            <Typography variant="caption" color="text.secondary">
              Pièce incomplète ou révision non validée : consultation seule —
              dimensions à compléter via une fiche technique validée.
            </Typography>
          )}
          <Stack direction="row" spacing={1}>
            <TextField size="small" type="number" label="X (cm)" value={piece.x.toFixed(1)}
              disabled={lockAll}
              onChange={(event) => onMove(piece.key, Number(event.target.value), piece.y, false)}
              onBlur={(event) => onMove(piece.key, Number(event.target.value), piece.y, true)} />
            <TextField size="small" type="number" label="Y (cm)" value={piece.y.toFixed(1)}
              disabled={lockAll}
              onChange={(event) => onMove(piece.key, piece.x, Number(event.target.value), false)}
              onBlur={(event) => onMove(piece.key, piece.x, Number(event.target.value), true)} />
          </Stack>
          <TextField
            size="small" select label="Rotation"
            value={String(piece.rotation)}
            disabled={lockAll}
            onChange={(event) => onRotate(piece.key, Number(event.target.value), true)}
            helperText="Seuls les angles autorisés par le droit-fil sont proposés."
          >
            {definition.allowedRotations.map((angle) => (
              <MenuItem key={angle} value={String(angle)}>{angle}°</MenuItem>
            ))}
          </TextField>
          <Typography variant="caption" color="text.secondary">
            {GRAIN_LABELS[definition.grainDirection] ?? definition.grainDirection}
          </Typography>
          <Divider />
          <Typography variant="body2" sx={{ fontWeight: 600, color: error ? 'error.main' : 'success.main' }}>
            {error ? 'Position invalide' : 'Position valide'}
          </Typography>
          {error && (
            <Typography variant="body2" color="error.main">{error}</Typography>
          )}
          {extent && (
            <Typography variant="caption" color="text.secondary">
              Emprise à l’écran : {extent.width.toFixed(0)} × {extent.height.toFixed(0)} cm (longueur × travers).
            </Typography>
          )}
          <Stack direction="row" spacing={1}>
            <Button size="small" variant="outlined" color="error" disabled={lockAll} onClick={() => onDelete(piece.key)}>
              Supprimer
            </Button>
            <Button size="small" variant="outlined" disabled={lockAll} onClick={() => onDuplicate(piece.key)}>
              Dupliquer
            </Button>
          </Stack>
        </>
      )}
      <Divider />
      <Typography variant="subtitle2">Plan</Typography>
      <Typography variant="body2">
        État : {planStatus === 'valide' ? 'validé (immuable)' : 'brouillon (proposition)'}
      </Typography>
      <Typography variant="body2">Efficacité (enregistrée) : {efficiency.toFixed(1)} %</Typography>
    </Box>
  );
}
