'use client';

import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

/**
 * Suivi horaire du travail : affiche l'heure de début, l'heure de fin
 * et la durée totale travaillée (pauses exclues). Quand `live` est vrai
 * (affectation en cours), le chrono défile chaque seconde côté client ;
 * l'horodatage de référence reste celui du serveur (UTC).
 */

/** Parse une horodate serveur « YYYY-MM-DD HH:MM:SS » (UTC) en Date locale. */
export function parseServerTimestamp(value: string): Date {
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}`;
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(normalized);
  return new Date(hasZone ? normalized : `${normalized}Z`);
}

export function formatWorkDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export interface WorkTimerProps {
  startedAt: string | null;
  endedAt: string | null;
  /** Secondes travaillées cumulées (pauses exclues), côté serveur. */
  workedSeconds: number;
  /** Ancre du segment en cours (updated_at du serveur). */
  anchorAt: string;
  /** Vrai si le travail est en cours (chrono défilant). */
  live: boolean;
}

export default function WorkTimer({
  startedAt, endedAt, workedSeconds, anchorAt, live,
}: WorkTimerProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return undefined;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [live]);

  if (!startedAt) {
    return (
      <Typography variant="body2" color="text.secondary">
        Pas encore démarré
      </Typography>
    );
  }

  const anchor = parseServerTimestamp(anchorAt).getTime();
  const baseSeconds = live
    ? workedSeconds + Math.max(0, (now - anchor) / 1000)
    : workedSeconds;
  const start = parseServerTimestamp(startedAt);
  const end = endedAt ? parseServerTimestamp(endedAt) : null;

  return (
    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'baseline' }}>
      <Typography variant="body2">
        Début :
        {' '}
        <strong>{start.toLocaleTimeString('fr-FR')}</strong>
      </Typography>
      {end ? (
        <Typography variant="body2">
          Fin :
          {' '}
          <strong>{end.toLocaleTimeString('fr-FR')}</strong>
        </Typography>
      ) : null}
      <Tooltip title="Durée travaillée, pauses exclues">
        <Typography
          variant="body2"
          component="span"
          sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}
          color={live ? 'success.main' : 'text.primary'}
        >
          {formatWorkDuration(baseSeconds)}
          {live ? ' ▸' : ''}
        </Typography>
      </Tooltip>
    </Box>
  );
}
