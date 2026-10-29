'use client';

import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

/**
 * Panneau éditorial gauche de la connexion : fils tissés animés, grain,
 * manifeste de marque et étapes en liste éditoriale. Présentation
 * uniquement, la logique métier n'est pas affectée.
 */

const GOLD = '#d8c49a';
const MUTED = '#96a29a';

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <Stack direction="row" spacing={1.6} alignItems="center">
      <Box
        className="jm-mark"
        sx={{
          width: 42,
          height: 42,
          borderRadius: '50%',
          border: `1px solid rgba(216,196,154,0.55)`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <Typography
          className="jm-serif"
          sx={{ color: GOLD, fontWeight: 600, fontSize: 15, letterSpacing: '0.08em' }}
        >
          JO
        </Typography>
      </Box>
      {!compact ? (
        <Typography
          sx={{
            color: '#eef0ea',
            fontWeight: 600,
            fontSize: 15,
            letterSpacing: '0.22em',
            textTransform: 'uppercase',
          }}
        >
          Management
        </Typography>
      ) : null}
    </Stack>
  );
}

function Threads() {
  return (
    <svg className="jm-threads" aria-hidden="true" preserveAspectRatio="none" viewBox="0 0 800 900">
      <path className="jm-thread" stroke="rgba(216,196,154,0.20)" d="M-40 120 C 220 60, 420 220, 840 140" />
      <path className="jm-thread" stroke="rgba(31,174,116,0.28)" d="M-40 300 C 260 380, 480 180, 840 330" />
      <path className="jm-thread" stroke="rgba(216,196,154,0.14)" d="M-40 520 C 200 440, 520 640, 840 500" />
      <path className="jm-thread" stroke="rgba(31,174,116,0.20)" d="M-40 720 C 280 800, 460 620, 840 760" />
      <path className="jm-thread" stroke="rgba(238,240,234,0.08)" d="M-40 840 C 240 760, 500 900, 840 820" />
    </svg>
  );
}

/**
 * Fil pointillé animé placé derrière un bloc de texte : deux courbes
 * cousues qui défilent lentement, en or et en émeraude.
 */
export function ThreadMotif({
  left,
  right,
  top,
  bottom,
  width,
  height,
  flip = false,
}: {
  left?: number | string;
  right?: number | string;
  top?: number | string;
  bottom?: number | string;
  width: number | string;
  height: number | string;
  flip?: boolean;
}) {
  return (
    <svg
      className="jm-motif"
      aria-hidden="true"
      viewBox="0 0 600 160"
      preserveAspectRatio="none"
      style={{
        left,
        right,
        top,
        bottom,
        width,
        height,
        transform: flip ? 'scaleX(-1)' : undefined,
      }}
    >
      <path stroke="rgba(216,196,154,0.35)" d="M-10 120 C 120 40, 260 170, 400 80 S 560 40, 620 90" />
      <path className="jm-motif-alt" stroke="rgba(31,174,116,0.40)" d="M-10 60 C 140 130, 300 20, 440 110 S 580 140, 620 70" />
    </svg>
  );
}

const STEPS = [
  { n: '01', label: 'Connexion sécurisée à votre atelier' },
  { n: '02', label: 'Suivi en direct : coupe, couture, qualité' },
  { n: '03', label: 'Pilotage fin des stocks et des équipes' },
];

export default function BrandPanel() {
  return (
    <Box
      className="jm-grain"
      sx={{
        position: 'relative',
        overflow: 'hidden',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        px: { lg: 8, xl: 10 },
        py: { lg: 6 },
      }}
    >
      <Threads />
      <Box
        className="jm-reveal"
        sx={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 2,
        }}
      >
        <BrandMark />
        <Box className="jm-vip-chip">Édition Premium</Box>
      </Box>

      <Box sx={{ flex: 1 }} />

      <Box sx={{ position: 'relative', maxWidth: 560 }}>
        <ThreadMotif
          left={-56}
          top={-34}
          width="calc(100% + 130px)"
          height={190}
        />
        <Box sx={{ position: 'relative', zIndex: 1 }}>
          <Typography
            className="jm-reveal"
            sx={{
              color: GOLD,
              fontSize: 12,
              letterSpacing: '0.34em',
              textTransform: 'uppercase',
              animationDelay: '0.15s',
            }}
          >
            Atelier numérique — Filière textile
          </Typography>
          <Typography
            className="jm-serif jm-reveal"
            sx={{
              mt: 3,
              fontSize: { lg: 58, xl: 68 },
              lineHeight: 1.04,
              fontWeight: 400,
              letterSpacing: '-0.01em',
              animationDelay: '0.3s',
            }}
          >
            L’excellence textile,
            <br />
            <Box component="em" sx={{ color: '#1fae74', fontStyle: 'italic' }}>
              pilotée à la fibre près.
            </Box>
          </Typography>
          <Typography
            className="jm-reveal"
            sx={{
              mt: 3,
              color: MUTED,
              fontSize: 16,
              lineHeight: 1.7,
              maxWidth: 440,
              animationDelay: '0.45s',
            }}
          >
            Notre objectif : une gestion intégrée de l’entreprise — de la coupe
            à l’expédition, chaque étape compte, chaque fil est suivi.
          </Typography>
        </Box>
      </Box>

      <Stack
        className="jm-reveal"
        sx={{ position: 'relative', mt: { lg: 6 }, animationDelay: '0.6s' }}
      >
        {STEPS.map((step) => (
          <Stack
            key={step.n}
            direction="row"
            spacing={2.5}
            alignItems="baseline"
            sx={{
              py: 1.8,
              borderTop: '1px solid rgba(216,196,154,0.16)',
              '&:last-child': { borderBottom: '1px solid rgba(216,196,154,0.16)' },
            }}
          >
            <Typography
              className="jm-serif"
              sx={{ color: GOLD, fontSize: 14, letterSpacing: '0.1em', flexShrink: 0 }}
            >
              {step.n}
            </Typography>
            <Typography sx={{ color: '#c9d2cb', fontSize: 14, letterSpacing: '0.02em' }}>
              {step.label}
            </Typography>
          </Stack>
        ))}
      </Stack>
    </Box>
  );
}
