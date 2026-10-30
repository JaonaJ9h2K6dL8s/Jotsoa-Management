'use client';

import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Popover from '@mui/material/Popover';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import Tooltip from '@mui/material/Tooltip';
import { atelierAction } from './api';
import type { CatalogueDTO, PatternDemoDTO } from './api';

interface PatternDemoPreviewProps {
  products: CatalogueDTO[];
  /**
   * Mode compact intégré à la barre de contrôle unique : une pastille
   * « Aperçu démo » dont le détail s'ouvre en popover (gain de place).
   */
  inline?: boolean;
}

export default function PatternDemoPreview({ products, inline = false }: PatternDemoPreviewProps) {
  const [expanded, setExpanded] = useState(false);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [productId, setProductId] = useState('');
  const [preview, setPreview] = useState<PatternDemoDTO | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    if (!productId) {
      setPreview(null);
      setError('');
      setLoading(false);
      return () => { active = false; };
    }
    setPreview(null);
    setError('');
    setLoading(true);
    atelierAction<PatternDemoDTO>('pattern.demo-preview', { productId: Number(productId) })
      .then((result) => { if (active) setPreview(result); })
      .catch((reason: Error) => { if (active) setError(reason.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [productId]);

  const content = (
    <Stack spacing={1}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <TextField
          select
          size="small"
          label="Produit — aperçu du patron"
          value={productId}
          onChange={(event) => setProductId(String(event.target.value))}
          sx={{ maxWidth: 420, flex: 1 }}
        >
          <MenuItem value="">Choisir un produit</MenuItem>
          {products.filter((product) => product.isActive).map((product) => (
            <MenuItem key={product.productId} value={product.productId}>
              {product.nom} · {product.family}
            </MenuItem>
          ))}
        </TextField>
        {!inline && (
          <Box
            component="button"
            onClick={() => setExpanded(false)}
            aria-label="Replier l’aperçu du patron"
            sx={{
              display: 'inline-flex', alignItems: 'center', cursor: 'pointer',
              border: '1px solid', borderColor: 'divider', borderRadius: 1,
              px: 1, py: 0.5, bgcolor: 'background.paper', fontSize: 12,
              '&:hover': { bgcolor: '#f4f7f5' },
            }}
          >
            Replier <ExpandMoreIcon sx={{ fontSize: 16, ml: 0.5 }} />
          </Box>
        )}
      </Box>
      <Alert severity="warning">
        Démonstration visuelle uniquement : formes non à l’échelle, sans mesures réelles,
        non utilisables pour le placement ou la coupe.
      </Alert>
      {loading && <Typography variant="body2">Génération de l’aperçu…</Typography>}
      {error && <Alert severity="error">{error}</Alert>}
      {preview && (
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))', gap: 1 }}>
          {preview.pieces.map((piece) => (
            <Paper key={piece.code} variant="outlined" sx={{ p: 0.75, textAlign: 'center' }}>
              <svg viewBox="0 0 100 100" width="100%" height="90" role="img" aria-label={`Démonstration : ${piece.label}`}>
                <polygon
                  points={piece.outline.map((point) => `${point.x},${point.y}`).join(' ')}
                  fill="#dbeafe"
                  stroke="#1d4ed8"
                  strokeWidth="1.5"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
              <Typography variant="caption" display="block">{piece.label} ×{piece.qty}</Typography>
              {!piece.required && <Typography variant="caption" color="text.secondary">Optionnelle</Typography>}
            </Paper>
          ))}
        </Box>
      )}
    </Stack>
  );

  // Mode compact : pastille dans la barre de contrôle, détail en popover.
  if (inline) {
    return (
      <>
        <Tooltip title="Visualiser les pièces d’un produit (démo, hors échelle)">
          <Chip
            size="small"
            component="button"
            onClick={(event) => setAnchorEl(event.currentTarget)}
            label="Aperçu démo"
            variant="outlined"
            sx={{ height: 24, cursor: 'pointer', '& .MuiChip-label': { fontSize: 11, px: 1 } }}
          />
        </Tooltip>
        <Popover
          open={anchorEl !== null}
          anchorEl={anchorEl}
          onClose={() => setAnchorEl(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
          transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        >
          <Box sx={{ p: 1.5, minWidth: 460 }}>
            {content}
          </Box>
        </Popover>
      </>
    );
  }

  // Replié par défaut : une fine ligne pour libérer la hauteur du canvas.
  if (!expanded) {
    return (
      <Paper
        variant="outlined"
        component="button"
        onClick={() => setExpanded(true)}
        sx={{
          mx: 1, mt: 0.5, py: 0.25, px: 1.25, display: 'flex',
          alignItems: 'center', gap: 0.75, cursor: 'pointer', textAlign: 'left',
          bgcolor: 'background.paper', '&:hover': { bgcolor: '#f4f7f5' },
        }}
      >
        <ChevronRightIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
        <Typography variant="caption" sx={{ fontWeight: 600 }}>
          Aperçu du patron (démo)
        </Typography>
        <Typography variant="caption" color="text.secondary">
          — visualiser les pièces d’un produit
        </Typography>
      </Paper>
    );
  }

  return (
    <Paper variant="outlined" sx={{ p: 1, mx: 1, mt: 0.5 }}>
      {content}
    </Paper>
  );
}
