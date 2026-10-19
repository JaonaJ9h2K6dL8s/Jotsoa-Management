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
 * Contenu de la barre latérale, style « dashboard premium » : identité
 * de l'application, navigation filtrée selon le rôle avec pilule active
 * pleine, et carte annonce en bas. Le filtrage visuel complète mais ne
 * remplace jamais les vérifications côté serveur.
 */

const itemSx = {
  borderRadius: '10px',
  mb: 0.25,
  color: 'text.secondary',
  '& .MuiListItemIcon-root': { color: 'inherit', minWidth: 42 },
  '&:hover': {
    backgroundColor: 'rgba(15,122,77,0.06)',
    color: 'primary.main',
  },
  '&.Mui-selected': {
    backgroundColor: 'primary.main',
    color: '#fff',
    boxShadow: '0 8px 18px rgba(15,122,77,0.35)',
    '& .MuiListItemIcon-root': { color: '#fff' },
    '&:hover': { backgroundColor: 'primary.main' },
  },
} as const;

export default function SidebarContent({ roleCode }: { roleCode: RoleCode }) {
  const pathname = usePathname();
  const items = NAV_BY_ROLE[roleCode];

  return (
    <Box className="flex h-full flex-col">
      <Toolbar className="items-center">
        <Box className="flex items-center gap-2 py-1">
          <Box
            aria-hidden
            sx={{
              width: 40,
              height: 40,
              borderRadius: '12px',
              display: 'grid',
              placeItems: 'center',
              flexShrink: 0,
              color: '#fff',
              fontWeight: 800,
              fontSize: 14,
              letterSpacing: '0.02em',
              background: 'linear-gradient(135deg, #0a5c3c, #1fae74)',
              boxShadow: '0 6px 14px rgba(15,122,77,0.35)',
            }}
          >
            JO
          </Box>
          <Box>
            <Typography variant="subtitle1" component="p" className="leading-tight">
              JO Management
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Gestion intégrée de l’entreprise
            </Typography>
          </Box>
        </Box>
      </Toolbar>
      <List dense className="flex-1 overflow-y-auto" sx={{ px: 0.5, pt: 1 }}>
        {items.map((item) => {
          const selected = item.href !== undefined && pathname.startsWith(item.href);
          return (
            <ListItem key={item.label} disablePadding
              secondaryAction={
                item.enabled ? undefined : (
                  <Chip label="À venir" size="small" variant="outlined" />
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
                <ListItemButton disabled aria-label={item.label} sx={itemSx}>
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
            p: 2.5,
            color: '#fff',
            background: 'linear-gradient(150deg, #0d6b45 0%, #0a5c3c 55%, #07352a 100%)',
            boxShadow: '0 14px 30px rgba(10,92,60,0.35)',
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
              background: 'rgba(255,255,255,0.10)',
            }}
          />
          <Box
            sx={{
              width: 36,
              height: 36,
              borderRadius: '10px',
              display: 'grid',
              placeItems: 'center',
              backgroundColor: 'rgba(255,255,255,0.16)',
              mb: 1.5,
            }}
          >
            <AutoAwesome fontSize="small" />
          </Box>
          <Typography variant="subtitle2" sx={{ fontSize: 15 }}>
            JO Analytics
          </Typography>
          <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.75)', display: 'block', mt: 0.5 }}>
            Pilotage avancé de votre production, bientôt dans votre espace.
          </Typography>
          <Box
            sx={{
              mt: 1.75,
              display: 'inline-flex',
              px: 2,
              py: 0.75,
              borderRadius: 999,
              backgroundColor: '#fff',
              color: '#0a5c3c',
              fontSize: 12.5,
              fontWeight: 700,
            }}
          >
            Bientôt disponible
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
