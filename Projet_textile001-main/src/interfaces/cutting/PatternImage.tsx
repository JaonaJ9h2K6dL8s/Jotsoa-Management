'use client';

import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Collapse from '@mui/material/Collapse';
import Typography from '@mui/material/Typography';
import { atelierAction, type PatternPreview, type RevisionDTO } from './api';

/**
 * Image de patron générée AUTOMATIQUEMENT depuis les contours validés
 * de la révision sélectionnée (aucun dessin manuel, aucune mesure
 * inventée : rendu des polygones persistés, avec code, dimensions et
 * quantité). Masquée pour un patron non validé.
 */

interface PatternImageProps {
  revision: RevisionDTO | null;
}

export default function PatternImage({ revision }: PatternImageProps) {
  const [preview, setPreview] = useState<PatternPreview | null>(null);
  const [expanded, setExpanded] = useState(true);
  const [unavailable, setUnavailable] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPreview(null);
    setUnavailable(null);
    if (!revision || revision.status !== 'valide') return undefined;
    atelierAction<PatternPreview>('pattern.preview', { revisionId: revision.id })
      .then((result) => {
        if (!cancelled) setPreview(result);
      })
      .catch((error) => {
        if (!cancelled) {
          setUnavailable(error instanceof Error ? error.message : 'Image indisponible.');
        }
      });
    return () => { cancelled = true; };
  }, [revision]);

  if (!revision || revision.status !== 'valide') return null;
  const title = `Patron généré — ${revision.modelName} (révision #${revision.id})`;

  return (
    <Box sx={{ mt: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant="subtitle2">{title}</Typography>
        <Button size="small" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Réduire' : 'Afficher'}
        </Button>
      </Box>
      <Collapse in={expanded}>
        {preview && (
          <Box sx={{
            mt: 1, border: '1px solid', borderColor: 'divider', borderRadius: 1,
            overflow: 'auto', bgcolor: '#f8fafc',
          }}>
            <img
              src={`data:image/svg+xml;utf8,${encodeURIComponent(preview.svg)}`}
              alt={title}
              style={{ display: 'block', maxWidth: '100%', height: 'auto' }}
            />
          </Box>
        )}
        {!preview && unavailable && (
          <Typography variant="caption" color="text.secondary">{unavailable}</Typography>
        )}
      </Collapse>
    </Box>
  );
}
