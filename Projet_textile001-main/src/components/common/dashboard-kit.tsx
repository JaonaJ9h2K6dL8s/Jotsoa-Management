import type { ReactNode } from 'react';
import Link from '@mui/material/Link';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

/**
 * Kit de présentation des tableaux de bord — inspiré des dashboards
 * modernes (bannière d'accueil, cartes KPI à pastille colorée, titres
 * de section éditoriaux). Strictement présentation : aucune donnée ni
 * logique métier n'est calculée ici, les composants affichent ce qui
 * leur est passé.
 */

export type KpiTone = 'emerald' | 'gold' | 'teal' | 'plum' | 'terracotta' | 'ink';

const TONES: Record<KpiTone, { bg: string; fg: string }> = {
  emerald: { bg: 'rgba(14,107,68,0.10)', fg: '#0e6b44' },
  gold: { bg: 'rgba(169,129,46,0.12)', fg: '#8a6a24' },
  teal: { bg: 'rgba(15,118,110,0.10)', fg: '#0f766e' },
  plum: { bg: 'rgba(125,74,107,0.10)', fg: '#7d4a6b' },
  terracotta: { bg: 'rgba(176,92,52,0.12)', fg: '#a04f28' },
  ink: { bg: 'rgba(25,31,28,0.07)', fg: '#39433d' },
};

const TONE_ORDER: KpiTone[] = ['emerald', 'gold', 'teal', 'plum', 'terracotta', 'ink'];

/** Couleur cyclée pour varier les cartes d'une même grille. */
export function kpiTone(index: number): KpiTone {
  return TONE_ORDER[index % TONE_ORDER.length];
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Bonjour';
  if (hour < 18) return 'Bon après-midi';
  return 'Bonsoir';
}

function formatNow(): string {
  return new Date().toLocaleString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function WelcomeBanner({
  name,
  roleLabel,
  moduleLabel,
  description,
}: {
  name: string;
  roleLabel: string;
  moduleLabel?: string;
  description: string;
}) {
  return (
    <Box
      className="jo-fade-in"
      sx={{
        position: 'relative',
        overflow: 'hidden',
        borderRadius: '20px',
        px: { xs: 3, md: 4 },
        py: { xs: 3, md: 4 },
        color: '#f3f1e9',
        background:
          'linear-gradient(120deg, #0a4f33 0%, #0e6b44 52%, #0d1410 115%)',
        boxShadow: '0 18px 44px rgba(10,79,51,0.28)',
      }}
    >
      <Box
        aria-hidden
        sx={{
          position: 'absolute',
          top: -70,
          right: -50,
          width: 240,
          height: 240,
          borderRadius: '50%',
          background: 'rgba(216,196,154,0.10)',
        }}
      />
      <Box
        aria-hidden
        sx={{
          position: 'absolute',
          bottom: -90,
          right: 120,
          width: 190,
          height: 190,
          borderRadius: '50%',
          border: '1px solid rgba(216,196,154,0.18)',
        }}
      />
      <Stack spacing={1.25} sx={{ position: 'relative' }}>
        <Box
          suppressHydrationWarning
          sx={{
            alignSelf: 'flex-start',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 1,
            px: 1.75,
            py: 0.5,
            borderRadius: 999,
            border: '1px solid rgba(216,196,154,0.35)',
            background: 'rgba(216,196,154,0.10)',
            color: '#e6d9b4',
            fontSize: 12.5,
            fontWeight: 600,
            letterSpacing: '0.04em',
          }}
        >
          {formatNow()}
        </Box>
        <Typography
          variant="h4"
          component="h2"
          sx={{
            fontFamily: 'var(--font-display), Georgia, serif',
            fontWeight: 600,
            color: '#fff',
          }}
        >
          {greeting()}, {name}
          <Box component="span" sx={{ color: '#d8c49a' }}>.</Box>
        </Typography>
        <Stack direction="row" spacing={1} useFlexGap className="flex-wrap">
          <Box
            sx={{
              px: 1.5,
              py: 0.4,
              borderRadius: 999,
              background: 'linear-gradient(90deg, rgba(216,196,154,0.9), rgba(216,196,154,0.7))',
              color: '#0a3d28',
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}
          >
            {roleLabel}
          </Box>
          {moduleLabel ? (
            <Box
              sx={{
                px: 1.5,
                py: 0.4,
                borderRadius: 999,
                border: '1px solid rgba(216,196,154,0.4)',
                color: '#e6d9b4',
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: '0.04em',
              }}
            >
              {moduleLabel}
            </Box>
          ) : null}
        </Stack>
        <Typography variant="body2" sx={{ color: 'rgba(243,241,233,0.78)', maxWidth: 640 }}>
          {description}
        </Typography>
      </Stack>
    </Box>
  );
}

export function KpiCard({
  label,
  value,
  hint,
  href,
  tone = 'emerald',
  icon,
}: {
  label: string;
  value: number | string;
  hint?: string;
  href?: string;
  tone?: KpiTone;
  icon?: ReactNode;
}) {
  const palette = TONES[tone];
  const card = (
    <Paper
      variant="outlined"
      className="jo-fade-in h-full"
      sx={{
        p: 2.25,
        display: 'flex',
        flexDirection: 'column',
        gap: 0.75,
        transition: 'transform .18s ease, box-shadow .18s ease',
        '&:hover': {
          transform: 'translateY(-2px)',
          boxShadow: '0 14px 30px rgba(25,31,28,0.10)',
        },
      }}
    >
      <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1}>
        <Typography
          variant="caption"
          sx={{
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'text.secondary',
            pt: 0.5,
          }}
        >
          {label}
        </Typography>
        {icon ? (
          <Box
            aria-hidden
            sx={{
              width: 38,
              height: 38,
              borderRadius: '11px',
              display: 'grid',
              placeItems: 'center',
              flexShrink: 0,
              backgroundColor: palette.bg,
              color: palette.fg,
            }}
          >
            {icon}
          </Box>
        ) : null}
      </Stack>
      <Typography
        variant="h4"
        component="p"
        sx={{
          fontFamily: 'var(--font-display), Georgia, serif',
          fontWeight: 600,
          color: palette.fg,
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1.1,
        }}
      >
        {value}
      </Typography>
      {hint ? (
        <Typography variant="caption" color="text.secondary">
          {hint}
        </Typography>
      ) : null}
    </Paper>
  );
  return href ? (
    <Link href={href} underline="none" color="inherit" className="h-full">
      {card}
    </Link>
  ) : (
    card
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <Stack spacing={0.75} sx={{ mt: 1 }}>
      <Typography
        variant="caption"
        component="h3"
        sx={{
          fontWeight: 700,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'text.secondary',
        }}
      >
        {children}
      </Typography>
      <Box
        aria-hidden
        sx={{
          width: 44,
          height: 3,
          borderRadius: 999,
          background: 'linear-gradient(90deg, #a9812e, rgba(169,129,46,0.15))',
        }}
      />
    </Stack>
  );
}
