'use client';

import { useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import type { PieceDTO, RevisionDTO } from './api';
import PatternImage from './PatternImage';

/**
 * Bibliothèque des patrons (panneau gauche, style Canva) :
 * miniatures vectorielles réelles, dimensions en cm, état de
 * configuration (les pièces incomplètes affichent ce qui manque et
 * ne sont pas glissables) et état de placement. Glisser une pièce
 * vers la table l'ajoute au plan (dépôt canvas).
 */

interface PanelPiecesProps {
  revision: RevisionDTO | null;
  placedCounts: Map<number, number>;
  onDragPiece: (piece: PieceDTO | null) => void;
  onAddPiece?: (piece: PieceDTO) => void;
}

function Miniature({ piece }: { piece: PieceDTO }) {
  const points = piece.points;
  if (points.length < 3) {
    return <Box sx={{ width: 44, height: 44, display: 'grid', placeItems: 'center', fontSize: 18 }}>✕</Box>;
  }
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const width = Math.max(...xs) - minX || 1;
  const height = Math.max(...ys) - minY || 1;
  const scale = 40 / Math.max(width, height);
  const d = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${((point.x - minX) * scale + 2).toFixed(1)} ${((point.y - minY) * scale + 2).toFixed(1)}`)
    .join(' ');
  return (
    <svg width={44} height={44} viewBox="0 0 44 44" aria-hidden>
      <path d={`${d} Z`} fill="rgba(59,130,246,0.12)" stroke="#3b82f6" strokeWidth={1.2} />
    </svg>
  );
}

export default function PanelPieces({ revision, placedCounts, onDragPiece, onAddPiece }: PanelPiecesProps) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const pieces = revision?.pieces ?? [];
    if (!term) return pieces;
    return pieces.filter(
      (piece) => piece.label.toLowerCase().includes(term) || piece.code.toLowerCase().includes(term),
    );
  }, [revision, search]);

  const unconfigured = revision?.unconfigured ?? [];

  return (
    <Box sx={{
      width: 300, flexShrink: 0, bgcolor: 'background.paper',
      borderRight: '1px solid', borderColor: 'divider',
      display: 'flex', flexDirection: 'column', minHeight: 0,
    }}>
      <Box sx={{ p: 2, pb: 1 }}>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          Patrons du modèle {revision ? `#${revision.id} (v${revision.version})` : '—'}
        </Typography>
        <TextField
          size="small"
          fullWidth
          placeholder="Rechercher une pièce…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </Box>
      <Box sx={{ flex: 1, overflowY: 'auto', px: 1.5, pb: 1 }}>
        <Stack spacing={1}>
          {filtered.map((piece) => {
            const placed = placedCounts.get(piece.id) ?? 0;
            const remaining = Math.max(0, piece.qty - placed);
            const usable = piece.points.length >= 3;
            return (
              <Box
                key={piece.id}
                draggable={usable}
                onDragStart={(event) => {
                  event.dataTransfer.setData('text/plain', String(piece.id));
                  onDragPiece(piece);
                }}
                onDragEnd={() => onDragPiece(null)}
                onDoubleClick={() => {
                  if (usable && onAddPiece) onAddPiece(piece);
                }}
                sx={{
                  display: 'flex', gap: 1.5, alignItems: 'center', p: 1,
                  borderRadius: 2, border: '1px solid', borderColor: 'divider',
                  bgcolor: usable ? 'background.paper' : '#fff7ed',
                  cursor: usable ? 'grab' : 'not-allowed',
                  opacity: remaining === 0 ? 0.55 : 1,
                  '&:hover': usable ? { borderColor: 'primary.main' } : undefined,
                }}
              >
                <Miniature piece={piece} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600, noWrap: true }}>
                    {piece.label}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    {piece.widthCm.toFixed(0)} × {piece.heightCm.toFixed(0)} cm · ×{piece.qty}
                  </Typography>
                  <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, flexWrap: 'wrap' }}>
                    {usable ? (
                      <Chip size="small" label={placed > 0 ? `placée ×${placed}` : 'disponible'}
                        color={placed > 0 ? 'success' : 'default'} sx={{ height: 20 }} />
                    ) : (
                      <Tooltip title="Pièce non utilisable en production : contour manquant.">
                        <Chip size="small" label="non coupable" color="error" sx={{ height: 20 }} />
                      </Tooltip>
                    )}
                    {remaining === 0 && usable && (
                      <Chip size="small" label="quota atteint" sx={{ height: 20 }} />
                    )}
                  </Stack>
                </Box>
              </Box>
            );
          })}
          {unconfigured.map((piece) => (
            <Box key={`missing-${piece.code}`} sx={{
              p: 1, borderRadius: 2, border: '1px dashed', borderColor: 'warning.main',
              bgcolor: '#fffbeb',
            }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>{piece.label}</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                À configurer — mesures manquantes : {piece.missingLabels.join(', ')}.
                Complétez la fiche technique puis régénérez le patron.
              </Typography>
              {piece.required && (
                <Chip size="small" label="bloque la validation" color="warning" sx={{ height: 20, mt: 0.5 }} />
              )}
            </Box>
          ))}
          {!revision && (
            <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
              Sélectionnez une révision de patron validée dans la barre supérieure.
            </Typography>
          )}
        </Stack>
      </Box>
      {revision && (
        <Box sx={{ px: 1.5, pb: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>
          <PatternImage revision={revision} />
        </Box>
      )}
    </Box>
  );
}
