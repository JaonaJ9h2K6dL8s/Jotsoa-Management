'use client';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import { useEffect, useState } from 'react';
import { apiGet } from '@/services/api-client';
import type { ApiHealthResponse } from '@/types/api';

type Status = 'loading' | 'ok' | 'error';

/**
 * Vérifie en temps réel que la base SQLite est initialisée
 * (appel de /api/health) avec états de chargement et d'erreur.
 */
export default function DatabaseStatus() {
  const [status, setStatus] = useState<Status>('loading');
  const [detail, setDetail] = useState('');

  useEffect(() => {
    let cancelled = false;

    apiGet<ApiHealthResponse>('/api/health')
      .then((data) => {
        if (cancelled) return;
        const count = data.database?.migrationsApplied.length ?? 0;
        setDetail(`${count} migration(s) appliquée(s)`);
        setStatus('ok');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setDetail(
          error instanceof Error ? error.message : 'Erreur inattendue',
        );
        setStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (status === 'loading') {
    return (
      <Box className="flex items-center gap-2">
        <CircularProgress size={18} aria-label="Vérification en cours" />
        <Typography variant="body2" color="text.secondary">
          Vérification de la base de données…
        </Typography>
      </Box>
    );
  }

  if (status === 'error') {
    return (
      <Alert severity="error" variant="outlined">
        Base de données indisponible : {detail}
      </Alert>
    );
  }

  return (
    <Box className="flex flex-wrap items-center gap-2">
      <Chip color="success" label="Base de données opérationnelle" />
      <Typography variant="body2" color="text.secondary">
        {detail}
      </Typography>
    </Box>
  );
}
