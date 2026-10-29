'use client';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import CloseIcon from '@mui/icons-material/Close';
import PauseIcon from '@mui/icons-material/Pause';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { apiGet } from '@/services/api-client';
import {
  CONTEXTUAL_MESSAGES,
  FREQUENCY_SECONDS,
  MASCOTS,
  type MascotConfig,
} from '@/lib/mascots/registry';
import MascotArt from './mascot-art';

/**
 * Bannière « Votre mascotte » affichée en haut du tableau de bord,
 * comme un encart d'accueil : mascotte animée à gauche, message au
 * centre, contrôles à droite.
 * - Configuration chargée depuis l'API (préférences de l'utilisateur).
 * - Animations CSS légères : salut au chargement, clignement,
 *   sautillement occasionnel — rien de permanent.
 * - Respect de prefers-reduced-motion (aucun mouvement si activé).
 * - Bouton « Mettre en pause » (pause de la session en cours).
 * - Masquage rapide par la croix (session en cours).
 */

type MascotAnimation = 'wave' | 'hop' | 'nod';

const ANIMATION_DURATION_MS = 2600;

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function Sparkle({
  x,
  y,
  size,
  color,
  delay,
}: {
  x: number;
  y: number;
  size: number;
  color: string;
  delay: number;
}) {
  return (
    <Box
      aria-hidden
      component="svg"
      viewBox="0 0 24 24"
      sx={{
        position: 'absolute',
        left: x,
        top: y,
        width: size,
        height: size,
        animation: `mascot-sparkle 2.6s ease-in-out ${delay}s infinite`,
        '@keyframes mascot-sparkle': {
          '0%, 100%': { opacity: 0.35, transform: 'scale(0.85)' },
          '50%': { opacity: 1, transform: 'scale(1.1)' },
        },
        '@media (prefers-reduced-motion: reduce)': {
          animation: 'none !important',
        },
      }}
    >
      <path
        d="M 12 2 L 14.2 9.8 L 22 12 L 14.2 14.2 L 12 22 L 9.8 14.2 L 2 12 L 9.8 9.8 Z"
        fill={color}
      />
    </Box>
  );
}

export default function MascotBanner({ homePath }: { homePath: string }) {
  const pathname = usePathname();
  const [config, setConfig] = useState<MascotConfig | null>(null);
  const [hidden, setHidden] = useState(false);
  const [paused, setPaused] = useState(false);
  const [animation, setAnimation] = useState<MascotAnimation | null>(null);
  const [taglineIndex, setTaglineIndex] = useState(0);
  const artRef = useRef<HTMLDivElement | null>(null);
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);

  const scheduleTimer = useCallback(
    (callback: () => void, delayMs: number) => {
      const timer = setTimeout(() => {
        timers.current = timers.current.filter((t) => t !== timer);
        callback();
      }, delayMs);
      timers.current.push(timer);
    },
    [],
  );

  const clearTimers = useCallback(() => {
    for (const timer of timers.current) clearTimeout(timer);
    timers.current = [];
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiGet<{ status: string; config: MascotConfig }>('/api/mascots')
      .then((data) => {
        if (!cancelled) setConfig(data.config);
      })
      .catch(() => {
        // Pas de bannière en cas d'erreur réseau : aucun blocage du dashboard.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const reducedMotion = useMemo(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);

  const animationsActive = Boolean(
    config?.animationEnabled && !paused && !reducedMotion,
  );

  // Salut de bienvenue au chargement du tableau de bord.
  useEffect(() => {
    if (!config || !config.animationEnabled || reducedMotion) return;
    setAnimation('wave');
    scheduleTimer(() => setAnimation(null), ANIMATION_DURATION_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.mascotId, config?.animationEnabled]);

  // Animations occasionnelles selon la fréquence choisie + messages.
  useEffect(() => {
    if (!config || !animationsActive) return;
    const activeConfig = config;
    let stopped = false;
    function loop(): void {
      if (stopped) return;
      const [min, max] = FREQUENCY_SECONDS[activeConfig.animationFrequency];
      scheduleTimer(() => {
        if (stopped) return;
        const choices: MascotAnimation[] = ['wave', 'hop', 'nod'];
        setAnimation(choices[Math.floor(Math.random() * choices.length)]);
        scheduleTimer(() => setAnimation(null), ANIMATION_DURATION_MS);
        if (activeConfig.messagesEnabled) {
          setTaglineIndex(
            Math.floor(
              Math.random() * CONTEXTUAL_MESSAGES[activeConfig.mascotId].length,
            ),
          );
        }
        loop();
      }, randomBetween(min, max) * 1000);
    }
    loop();
    return () => {
      stopped = true;
    };
  }, [config, animationsActive, scheduleTimer]);

  // Clignement des yeux, limité aux yeux de cette bannière.
  useEffect(() => {
    if (!config || !animationsActive) return;
    let stopped = false;
    function blink(): void {
      const eyes = artRef.current?.querySelectorAll<HTMLElement>('.mascot-eye');
      eyes?.forEach((eye) => {
        eye.style.transform = 'scaleY(0.1)';
        setTimeout(() => {
          eye.style.transform = 'scaleY(1)';
        }, 140);
      });
    }
    function loop(): void {
      if (stopped) return;
      scheduleTimer(() => {
        if (stopped) return;
        blink();
        loop();
      }, randomBetween(3200, 7000));
    }
    loop();
    return () => {
      stopped = true;
    };
  }, [config, animationsActive, scheduleTimer]);

  useEffect(() => clearTimers, [clearTimers]);

  function handleClick(): void {
    if (!config || !animationsActive) return;
    setAnimation('wave');
    scheduleTimer(() => setAnimation(null), ANIMATION_DURATION_MS);
  }

  if (!config || !config.animationEnabled || hidden) return null;
  if (pathname !== homePath) return null;

  const mascot = MASCOTS[config.mascotId];
  const taglines = CONTEXTUAL_MESSAGES[config.mascotId];
  const tagline = config.messagesEnabled
    ? taglines[taglineIndex % taglines.length]
    : 'À vous de jouer.';

  return (
    <Paper
      elevation={0}
      sx={{
        position: 'relative',
        overflow: 'hidden',
        borderRadius: '20px',
        p: { xs: 2.5, md: 3 },
        mb: 3,
        bgcolor: 'background.paper',
        border: '1px solid',
        borderColor: 'divider',
        backgroundImage:
          'radial-gradient(circle at 8% 50%, rgba(31,174,116,0.10) 0%, rgba(31,174,116,0) 45%)',
        display: 'flex',
        flexDirection: { xs: 'column', md: 'row' },
        alignItems: { xs: 'flex-start', md: 'center' },
        gap: { xs: 2, md: 4 },
      }}
    >
      {/* Mascotte animée */}
      <Box
        aria-hidden
        onClick={handleClick}
        sx={{
          position: 'relative',
          width: 116,
          height: 116,
          flexShrink: 0,
          display: 'grid',
          placeItems: 'center',
          cursor: 'pointer',
          animation:
            animation === 'hop'
              ? 'mascot-banner-hop 1.1s ease-in-out infinite'
              : animation === 'wave'
                ? 'mascot-banner-wave 1.1s ease-in-out 2'
                : animation === 'nod'
                  ? 'mascot-banner-nod 0.9s ease-in-out 2'
                  : 'none',
          '@keyframes mascot-banner-wave': {
            '0%, 100%': { transform: 'rotate(0deg)' },
            '25%': { transform: 'rotate(-8deg)' },
            '75%': { transform: 'rotate(8deg)' },
          },
          '@keyframes mascot-banner-hop': {
            '0%, 100%': { transform: 'translateY(0)' },
            '50%': { transform: 'translateY(-9px)' },
          },
          '@keyframes mascot-banner-nod': {
            '0%, 100%': { transform: 'scale(1)' },
            '50%': { transform: 'scale(1.07, 0.93)' },
          },
          '@media (prefers-reduced-motion: reduce)': {
            animation: 'none !important',
          },
        }}
      >
        <Sparkle x={-4} y={8} size={16} color="#f4c531" delay={0} />
        <Sparkle x={94} y={0} size={20} color="#27a365" delay={0.9} />
        <Sparkle x={100} y={80} size={12} color="#8b5cf6" delay={1.7} />
        <Box ref={artRef} sx={{ width: 96, height: 96 }}>
          <MascotArt id={config.mascotId} size={96} />
        </Box>
      </Box>

      {/* Message */}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography
          variant="caption"
          sx={{
            textTransform: 'uppercase',
            letterSpacing: '0.09em',
            fontWeight: 700,
            color: 'text.secondary',
          }}
        >
          Votre mascotte · L&apos;élan du jour
        </Typography>
        <Typography variant="h6" component="p" sx={{ fontWeight: 700, mt: 0.5 }}>
          {mascot.welcome}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {tagline}
        </Typography>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: 'block', mt: 1 }}
        >
          {animationsActive
            ? 'Animation active'
            : reducedMotion
              ? 'Animations réduites (préférence système)'
              : 'Animation en pause'}
        </Typography>
      </Box>

      {/* Contrôles */}
      <Stack
        direction={{ xs: 'row', md: 'column' }}
        spacing={1.5}
        alignItems={{ xs: 'center', md: 'flex-end' }}
        sx={{ flexShrink: 0 }}
      >
        <Button
          variant="contained"
          color={paused ? 'primary' : 'inherit'}
          startIcon={paused ? <PlayArrowIcon /> : <PauseIcon />}
          onClick={() => setPaused((value) => !value)}
          sx={{
            ...(paused
              ? {}
              : {
                  bgcolor: 'rgba(31,174,116,0.12)',
                  color: '#0a5c3c',
                  '&:hover': { bgcolor: 'rgba(31,174,116,0.2)' },
                }),
          }}
        >
          {paused ? 'Reprendre' : 'Mettre en pause'}
        </Button>
        <Link
          href="/mon-compte"
          underline="hover"
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.5,
            fontWeight: 700,
            color: 'primary.main',
            fontSize: 14,
          }}
        >
          Personnaliser
          <ArrowForwardIcon sx={{ fontSize: 16 }} />
        </Link>
      </Stack>

      {/* Masquage rapide (session en cours) */}
      <IconButton
        aria-label="Masquer la mascotte"
        size="small"
        onClick={() => setHidden(true)}
        sx={{
          position: 'absolute',
          top: 10,
          right: 10,
          width: 28,
          height: 28,
          color: 'text.secondary',
        }}
      >
        <CloseIcon sx={{ fontSize: 16 }} />
      </IconButton>
    </Paper>
  );
}
