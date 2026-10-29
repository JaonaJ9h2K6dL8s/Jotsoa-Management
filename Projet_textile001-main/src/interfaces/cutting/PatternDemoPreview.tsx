'use client';

import { useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { atelierAction } from './api';
import type { CatalogueDTO, PatternDemoDTO } from './api';

interface PatternDemoPreviewProps {
  products: CatalogueDTO[];
}

export default function PatternDemoPreview({ products }: PatternDemoPreviewProps) {
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

  return (
    <Paper variant="outlined" sx={{ p: 1, mx: 1, mt: 1 }}>
      <Stack spacing={1}>
        <TextField
          select
          size="small"
          label="Produit — aperçu du patron"
          value={productId}
          onChange={(event) => setProductId(String(event.target.value))}
          sx={{ maxWidth: 420 }}
        >
          <MenuItem value="">Choisir un produit</MenuItem>
          {products.filter((product) => product.isActive).map((product) => (
            <MenuItem key={product.productId} value={product.productId}>
              {product.nom} · {product.family}
            </MenuItem>
          ))}
        </TextField>
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
    </Paper>
  );
}
