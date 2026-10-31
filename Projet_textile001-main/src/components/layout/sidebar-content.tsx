'use client';

import AutoAwesome from '@mui/icons-material/AutoAwesome';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV_BY_ROLE } from '@/lib/permissions';
import type { RoleCode } from '@/lib/roles';
import NavIcon from './nav-icon';

/**
 * Contenu de la barre latérale, style « maison de luxe textile » :
 * panneau encre foncé avec filets dorés (aligné sur la page de
 * connexion), navigation filtrée selon le rôle avec pilule active
 * émeraude sertie d'or, et carte annonce en bas. Le filtrage visuel
 * complète mais ne remplace jamais les vérifications côté serveur.
 */

const itemSx = {
  borderRadius: '10px',
  mb: 0.25,
  color: '#b7c2ba',
  '& .MuiListItemIcon-root': { color: 'inherit', minWidth: 42 },
  '&:hover': {
    backgroundColor: 'rgba(216,196,154,0.10)',
    color: '#eef0ea',
  },
  '&.Mui-selected': {
    background: 'linear-gradient(135deg, #0a4f33 0%, #0e6b44 60%, #1c9e6b 140%)',
    color: '#fff',
    boxShadow:
      'inset 0 0 0 1px rgba(216,196,154,0.40), 0 8px 20px rgba(10,79,51,0.45)',
    '& .MuiListItemIcon-root': { color: '#d8c49a' },
    '&:hover': {
      background: 'linear-gradient(135deg, #0a4f33 0%, #0e6b44 60%, #1c9e6b 140%)',
    },
  },
} as const;

export default function SidebarContent({ roleCode }: { roleCode: RoleCode }) {
  const pathname = usePathname();
  const items = NAV_BY_ROLE[roleCode];

  return (
    <Box className="flex h-full flex-col">
      <Toolbar className="items-center">
        <Box className="flex items-center gap-2.5 py-1">
          <Box
            className="jm-mark"
            aria-hidden
            sx={{
              width: 40,
              height: 40,
              borderRadius: '50%',
              border: '1px solid rgba(216,196,154,0.55)',
              display: 'grid',
              placeItems: 'center',
              flexShrink: 0,
            }}
          >
            <Typography
              sx={{
                fontFamily: 'var(--font-display), Georgia, serif',
                color: '#d8c49a',
                fontWeight: 600,
                fontSize: 14,
                letterSpacing: '0.08em',
              }}
            >
              JO
            </Typography>
          </Box>
          <Box>
            <Typography
              component="p"
              className="leading-tight"
              sx={{
                fontFamily: 'var(--font-display), Georgia, serif',
                color: '#eef0ea',
                fontSize: 16.5,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
              }}
            >
              JO Management
            </Typography>
            <Typography
              variant="caption"
              sx={{ color: 'rgba(216,196,154,0.75)', letterSpacing: '0.06em' }}
            >
              Gestion intégrée de l’entreprise
            </Typography>
          </Box>
        </Box>
      </Toolbar>
      <Box
        aria-hidden
        sx={{
          mx: 2,
          height: '1px',
          flexShrink: 0,
          background:
            'linear-gradient(90deg, transparent, rgba(216,196,154,0.35), transparent)',
        }}
      />
      <List dense className="flex-1 overflow-y-auto" sx={{ px: 0.5, pt: 1 }}>
        {items.map((item) => {
          const selected = item.href !== undefined && pathname.startsWith(item.href);
          return (
            <ListItem key={item.label} disablePadding
              secondaryAction={
                item.enabled ? undefined : (
                  <Chip
                    label="À venir"
                    size="small"
                    variant="outlined"
                    sx={{
                      borderColor: 'rgba(216,196,154,0.40)',
                      color: 'rgba(216,196,154,0.85)',
                      fontSize: 11,
                    }}
                  />
                )
              }
            >
              {item.enabled && item.href ? (
                <ListItemButton
                  component={Link}
                  href={item.href}
                  selected={selected}
                  aria-label={item.label}
                  sx={itemSx}
                >
                  <ListItemIcon>
                    <NavIcon iconKey={item.iconKey} />
                  </ListItemIcon>
                  <ListItemText
                    primary={item.label}
                    primaryTypographyProps={{ fontSize: 14.5, fontWeight: selected ? 700 : 500 }}
                  />
                </ListItemButton>
              ) : (
                <ListItemButton disabled aria-label={item.label} sx={{ ...itemSx, opacity: 0.55 }}>
                  <ListItemIcon>
                    <NavIcon iconKey={item.iconKey} />
                  </ListItemIcon>
                  <ListItemText
                    primary={item.label}
                    primaryTypographyProps={{ fontSize: 14.5, fontWeight: 500 }}
                  />
                </ListItemButton>
              )}
            </ListItem>
          );
        })}
      </List>
      <Box sx={{ p: 2 }}>
        <Box
          aria-hidden
          sx={{
            position: 'relative',
            overflow: 'hidden',
            borderRadius: '16px',
            border: '1px solid rgba(216,196,154,0.22)',
            p: 2.5,
            color: '#fff',
            background: 'linear-gradient(150deg, #0d1a13 0%, #0a1710 55%, #07100b 100%)',
            boxShadow: 'inset 0 0 0 1px rgba(216,196,154,0.06)',
          }}
        >
          <Box
            sx={{
              position: 'absolute',
              top: -34,
              right: -34,
              width: 110,
              height: 110,
              borderRadius: '50%',
              background: 'rgba(216,196,154,0.08)',
            }}
          />
          <Box
            sx={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              border: '1px solid rgba(216,196,154,0.45)',
              display: 'grid',
              placeItems: 'center',
              color: '#d8c49a',
              mb: 1.5,
            }}
          >
            <AutoAwesome fontSize="small" />
          </Box>
          <Typography
            variant="subtitle2"
            sx={{
              fontFamily: 'var(--font-display), Georgia, serif',
              fontSize: 15,
              letterSpacing: '0.02em',
            }}
          >
            JO Analytics
          </Typography>
          <Typography variant="caption" sx={{ color: 'rgba(183,194,186,0.8)', display: 'block', mt: 0.5 }}>
            Pilotage avancé de votre production, bientôt dans votre espace.
          </Typography>
          <Box
            sx={{
              mt: 1.75,
              display: 'inline-flex',
              px: 2,
              py: 0.75,
              borderRadius: 999,
              border: '1px solid rgba(216,196,154,0.45)',
              background: 'linear-gradient(90deg, rgba(216,196,154,0.14), rgba(216,196,154,0.04))',
              color: '#d8c49a',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
            }}
          >
            Bientôt disponible
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
