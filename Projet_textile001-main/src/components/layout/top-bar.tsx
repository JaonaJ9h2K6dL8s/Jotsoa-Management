'use client';

import MenuIcon from '@mui/icons-material/Menu';
import Logout from '@mui/icons-material/Logout';
import Search from '@mui/icons-material/Search';
import AppBar from '@mui/material/AppBar';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import InputBase from '@mui/material/InputBase';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Paper from '@mui/material/Paper';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import { useRouter } from 'next/navigation';
import { usePathname } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useUiStore } from '@/store/ui-store';
import type { SessionUser } from '@/types/auth';
import { apiPost } from '@/services/api-client';
import { NAV_BY_ROLE } from '@/lib/permissions';
import NavIcon from './nav-icon';
import RealtimeStatus from '@/components/realtime/realtime-status';

export const DRAWER_WIDTH = 280;

/**
 * Barre supérieure : navigation mobile, recherche rapide parmi les
 * pages autorisées du rôle, identité de l'utilisateur connecté
 * (nom + rôle) et bouton de déconnexion.
 */
export default function TopBar({ user }: { user: SessionUser }) {
  const toggleMobileNav = useUiStore((state) => state.toggleMobileNav);
  const sidebarCollapsed = useUiStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);
  const router = useRouter();
  const pathname = usePathname();
  // Mode atelier (pages /coupe/*) : barre minimale dense façon Illustrator —
  // sans recherche ni encombrement, pour laisser toute la hauteur au canvas.
  const isWorkshop = pathname.startsWith('/coupe');
  const [loggingOut, setLoggingOut] = useState(false);
  const [query, setQuery] = useState('');

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return NAV_BY_ROLE[user.roleCode].filter(
      (item) =>
        item.enabled &&
        item.href !== undefined &&
        item.label.toLowerCase().includes(needle),
    );
  }, [query, user.roleCode]);

  function goTo(href: string) {
    setQuery('');
    router.push(href);
  }

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await apiPost('/api/auth/logout', {});
    } catch {
      // La session est invalidée côté serveur ; on retourne à la connexion.
    }
    router.replace('/login');
  }

  return (
    <AppBar
      position="fixed"
      color="inherit"
      elevation={0}
      sx={{
        borderBottom: '1px solid rgba(30,36,48,0.06)',
        width: {
          md: `calc(100% - ${sidebarCollapsed ? 0 : DRAWER_WIDTH}px)`,
        },
        ml: { md: `${sidebarCollapsed ? 0 : DRAWER_WIDTH}px` },
        transition: 'width 220ms ease, margin 220ms ease',
      }}
    >
      <Toolbar variant={isWorkshop ? 'dense' : undefined} className="gap-2">
        {/* Hamburger mobile : ouvre le tiroir de navigation */}
        <IconButton
          aria-label="Ouvrir la navigation"
          edge="start"
          onClick={toggleMobileNav}
          sx={{ display: { md: 'none' }, mr: 1 }}
        >
          <MenuIcon />
        </IconButton>
        {/* Hamburger grand écran : affiche ou masque la barre latérale */}
        <IconButton
          aria-label={
            sidebarCollapsed
              ? 'Afficher la barre latérale'
              : 'Masquer la barre latérale'
          }
          edge="start"
          onClick={toggleSidebar}
          sx={{
            display: { xs: 'none', md: 'inline-flex' },
            mr: 1,
            transition: 'transform 220ms ease',
            '&:hover': { backgroundColor: 'rgba(15,122,77,0.08)' },
          }}
        >
          <MenuIcon />
        </IconButton>
        <Typography
          variant="h6"
          component="h1"
          noWrap
          sx={{ fontWeight: 800, fontSize: isWorkshop ? 16 : 20 }}
        >
          {user.roleLabel}
        </Typography>

        {/* Recherche rapide de navigation (masquée en mode atelier) */}
        {!isWorkshop && (
        <Box sx={{ position: 'relative', flex: 1, maxWidth: 460, mx: 'auto', px: { xs: 0, md: 2 } }}>
          <InputBase
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && matches[0]?.href) goTo(matches[0].href);
              if (event.key === 'Escape') setQuery('');
            }}
            placeholder="Rechercher une page…"
            aria-label="Rechercher une page"
            startAdornment={
              <Search sx={{ color: 'text.secondary', fontSize: 20, mr: 1 }} />
            }
            sx={{
              width: '100%',
              px: 1.75,
              py: 1,
              fontSize: 14,
              borderRadius: '12px',
              backgroundColor: '#f3f5fb',
              border: '1px solid transparent',
              transition: 'border-color .15s, background-color .15s',
              '&:hover': { backgroundColor: '#eef1f9' },
              '&:focus-within': {
                backgroundColor: '#fff',
                borderColor: 'primary.main',
                boxShadow: '0 0 0 3px rgba(15,122,77,0.14)',
              },
            }}
          />
          {query.trim() ? (
            <Paper
              sx={{
                position: 'absolute',
                top: 'calc(100% + 8px)',
                left: { md: 8 },
                right: { md: 8 },
                zIndex: 1300,
                maxHeight: 320,
                overflowY: 'auto',
                borderRadius: '12px',
              }}
            >
              {matches.length ? (
                <List dense disablePadding>
                  {matches.map((item) => (
                    <ListItemButton
                      key={item.href}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        goTo(item.href as string);
                      }}
                    >
                      <ListItemIcon sx={{ minWidth: 40 }}>
                        <NavIcon iconKey={item.iconKey} fontSize="small" />
                      </ListItemIcon>
                      <ListItemText primary={item.label} />
                    </ListItemButton>
                  ))}
                </List>
              ) : (
                <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
                  Aucune page ne correspond à « {query.trim()} ».
                </Typography>
              )}
            </Paper>
          ) : null}
        </Box>
        )}

        {!isWorkshop && <RealtimeStatus />}

        {!isWorkshop && (
        <Box className="hidden items-center gap-2 sm:flex">
          <Box className="text-right leading-tight">
            <Typography variant="body2" noWrap sx={{ fontWeight: 700 }}>
              {user.prenom ? `${user.prenom} ${user.nom}` : user.nom}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap>
              {user.roleLabel}
            </Typography>
          </Box>
          <Avatar
            alt={user.nom}
            sx={{
              width: 38,
              height: 38,
              fontSize: 14,
              fontWeight: 700,
              color: '#fff',
              background: 'linear-gradient(135deg, #0a5c3c, #1fae74)',
              boxShadow: '0 4px 10px rgba(15,122,77,0.35)',
            }}
          >
            {(user.prenom?.[0] ?? user.nom[0] ?? '?').toUpperCase()}
          </Avatar>
        </Box>
        )}
        <Button
          onClick={handleLogout}
          disabled={loggingOut}
          startIcon={<Logout />}
          color="inherit"
          sx={{
            borderRadius: '10px',
            px: isWorkshop ? 0.75 : 1.5,
            minWidth: 0,
            color: 'text.secondary',
            '&:hover': {
              color: 'error.main',
              backgroundColor: 'rgba(211,47,47,0.06)',
            },
          }}
        >
          {isWorkshop ? '' : 'Déconnexion'}
        </Button>
      </Toolbar>
    </AppBar>
  );
}
