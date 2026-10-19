'use client';

import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useRealtimeStore } from './realtime-bridge';

/**
 * Indicateur de l'état du canal temps réel, affiché dans la barre
 * supérieure : point vert « Temps réel » quand la station reçoit les
 * événements du serveur, point gris « Hors ligne » en cas de coupure
 * réseau (le navigateur retente automatiquement).
 */

const PULSE_KEYFRAMES = {
  '@keyframes jo-pulse': {
    '0%, 100%': { opacity: 1 },
    '50%': { opacity: 0.45 },
  },
} as const;

export default function RealtimeStatus() {
  const status = useRealtimeStore((state) => state.status);
  const connected = status === 'connecte';

  return (
    <Tooltip title={connected
      ? 'Données synchronisées en temps réel avec le serveur.'
      : 'Connexion au serveur perdue — nouvelle tentative automatique.'}
    >
      <Box
        sx={{
          display: { xs: 'none', sm: 'flex' },
          alignItems: 'center',
          gap: 0.75,
          px: 1.25,
          py: 0.5,
          borderRadius: 999,
          backgroundColor: connected ? 'rgba(31,174,116,0.10)' : 'rgba(30,36,48,0.06)',
          ...PULSE_KEYFRAMES,
        }}
      >
        <Box
          aria-hidden
          sx={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            backgroundColor: connected ? '#1fae74' : '#9aa2b1',
            animation: connected ? 'jo-pulse 1.6s ease-in-out infinite' : 'none',
          }}
        />
        <Typography
          variant="caption"
          sx={{ fontWeight: 700, color: connected ? '#0a5c3c' : 'text.secondary' }}
        >
          {connected ? 'Temps réel' : 'Hors ligne'}
        </Typography>
      </Box>
    </Tooltip>
  );
}
