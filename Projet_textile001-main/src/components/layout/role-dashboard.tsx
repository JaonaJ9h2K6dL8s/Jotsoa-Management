import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import Grid from '@mui/material/Grid';
import Chip from '@mui/material/Chip';
import Box from '@mui/material/Box';
import NavIcon from './nav-icon';
import type { NavIconKey } from '@/lib/permissions';

/**
 * Tableau de bord générique d'un espace métier : message d'accueil
 * personnalisé et raccourcis autorisés selon le rôle, présentés en
 * cartes claires à icônes pastel. Aucune donnée de production n'est
 * simulée.
 */

export interface DashboardShortcut {
  label: string;
  description: string;
  iconKey: NavIconKey;
  href?: string;
  enabled?: boolean;
}

const PASTELS = [
  { bg: '#fdeaea', fg: '#d9534f' },
  { bg: '#fff3e0', fg: '#ef8f2e' },
  { bg: '#e4f7ec', fg: '#27a365' },
  { bg: '#f1ebfb', fg: '#8b5cf6' },
  { bg: '#e7f1fd', fg: '#3b82d6' },
  { bg: '#e0f5f1', fg: '#12a594' },
];

export default function RoleDashboard({
  greeting,
  roleLabel,
  subtitle,
  shortcuts,
}: {
  greeting: string;
  roleLabel: string;
  subtitle: string;
  shortcuts: DashboardShortcut[];
}) {
  return (
    <Stack spacing={3}>
      <Paper
        className="p-6"
        sx={{ position: 'relative', overflow: 'hidden', borderRadius: '16px' }}
      >
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            top: -70,
            right: -60,
            width: 200,
            height: 200,
            borderRadius: '50%',
            background:
              'radial-gradient(circle, rgba(31,174,116,0.10) 0%, rgba(31,174,116,0) 70%)',
          }}
        />
        <Stack direction="row" spacing={2} alignItems="center" useFlexGap>
          <Box
            aria-hidden
            sx={{
              width: 50,
              height: 50,
              borderRadius: '14px',
              display: 'grid',
              placeItems: 'center',
              flexShrink: 0,
              color: '#0a5c3c',
              fontWeight: 800,
              fontSize: 20,
              backgroundColor: '#e4f7ec',
            }}
          >
            {roleLabel.charAt(0)}
          </Box>
          <Box>
            <Typography variant="h5" component="h2">
              {greeting}
            </Typography>
            <Stack direction="row" spacing={1} className="mt-1" useFlexGap>
              <Chip
                label={roleLabel}
                size="small"
                sx={{
                  backgroundColor: '#e4f7ec',
                  color: '#0a5c3c',
                  fontWeight: 700,
                }}
              />
            </Stack>
            <Typography color="text.secondary" className="mt-1">
              {subtitle}
            </Typography>
          </Box>
        </Stack>
      </Paper>

      <Typography variant="h6" component="h3">
        Raccourcis autorisés
      </Typography>
      <Grid container spacing={2}>
        {shortcuts.map((shortcut, index) => {
          const enabled = shortcut.enabled && shortcut.href;
          const pastel = PASTELS[index % PASTELS.length];
          const content = (
            <Paper
              className="h-full p-3"
              sx={{
                borderRadius: '16px',
                transition: 'transform .18s, box-shadow .18s',
                ...(enabled
                  ? {
                      cursor: 'pointer',
                      '&:hover': {
                        transform: 'translateY(-4px)',
                        boxShadow:
                          '0 6px 14px rgba(29,41,57,0.08), 0 18px 40px rgba(29,41,57,0.12)',
                      },
                    }
                  : { opacity: 0.6 }),
              }}
            >
              <Stack spacing={1.5}>
                <Box
                  aria-hidden
                  sx={{
                    width: 42,
                    height: 42,
                    borderRadius: '12px',
                    display: 'grid',
                    placeItems: 'center',
                    backgroundColor: pastel.bg,
                    color: pastel.fg,
                  }}
                >
                  <NavIcon iconKey={shortcut.iconKey} />
                </Box>
                <Typography variant="subtitle1" component="h4" className="leading-tight">
                  {shortcut.label}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {shortcut.description}
                </Typography>
                {enabled ? null : (
                  <Chip label="À venir" size="small" variant="outlined" sx={{ alignSelf: 'flex-start' }} />
                )}
              </Stack>
            </Paper>
          );
          return (
            <Grid key={shortcut.label} size={{ xs: 12, sm: 6, md: 4 }}>
              {enabled ? (
                <Link href={shortcut.href as string} underline="none" color="inherit">
                  {content}
                </Link>
              ) : (
                content
              )}
            </Grid>
          );
        })}
      </Grid>

      <Paper className="p-4" sx={{ borderRadius: '16px' }}>
        <Typography variant="body2" color="text.secondary">
          Les fonctionnalités métier de ce module seront activées
          progressivement dans les prochaines étapes du projet.
        </Typography>
      </Paper>
    </Stack>
  );
}
