'use client';

import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useEffect, useState } from 'react';

/**
 * Marque fixe d'état du serveur, présente sur toutes les interfaces.
 * Interroge /api/health périodiquement : vert = serveur démarré et
 * base accessible, rouge = serveur injoignable avec détail de l'erreur.
 */

type Status = 'checking' | 'ok' | 'down';

const CHECK_INTERVAL_MS = 20_000;
const TIMEOUT_MS = 5_000;

const DOT_COLOR: Record<Status, string> = {
  checking: '#9e9e9e',
  ok: '#2e7d32',
  down: '#d32f2f',
};

const LABEL: Record<Status, string> = {
  checking: 'Vérification du serveur…',
  ok: 'Serveur démarré',
  down: 'Serveur déconnecté',
};

async function checkHealth(): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch('/api/health', {
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        message?: string;
      } | null;
      throw new Error(body?.message ?? `Réponse HTTP ${response.status}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

export default function ServerStatusBadge() {
  const [status, setStatus] = useState<Status>('checking');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        await checkHealth();
        if (!cancelled) {
          setStatus('ok');
          setError(null);
        }
      } catch (cause) {
        if (!cancelled) {
          setStatus('down');
          setError(
            cause instanceof Error
              ? cause.name === 'AbortError'
                ? `Aucune réponse du serveur après ${TIMEOUT_MS / 1000} s.`
                : cause.message
              : 'Erreur inconnue.',
          );
        }
      }
    };

    void run();
    const interval = setInterval(() => void run(), CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <Paper
      elevation={3}
      role="status"
      aria-live="polite"
      sx={{
        position: 'fixed',
        bottom: 12,
        left: 12,
        zIndex: (theme) => theme.zIndex.tooltip,
        px: 1.5,
        py: 0.75,
        borderRadius: 999,
        maxWidth: 340,
      }}
    >
      <Stack direction="row" spacing={1} alignItems="center">
        <Box
          sx={{
            width: 10,
            height: 10,
            borderRadius: '50%',
            backgroundColor: DOT_COLOR[status],
            flexShrink: 0,
            ...(status === 'checking'
              ? { animation: 'pulse 1.2s ease-in-out infinite' }
              : {}),
            '@keyframes pulse': {
              '0%, 100%': { opacity: 1 },
              '50%': { opacity: 0.3 },
            },
          }}
        />
        <Typography variant="caption" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
          {LABEL[status]}
        </Typography>
      </Stack>
      {status === 'down' && error ? (
        <Tooltip title={error} placement="top">
          <Typography
            variant="caption"
            color="error"
            sx={{
              display: 'block',
              mt: 0.25,
              maxWidth: 320,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            Erreur : {error}
          </Typography>
        </Tooltip>
      ) : null}
    </Paper>
  );
}
