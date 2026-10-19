'use client';

import Box from '@mui/material/Box';
import Drawer from '@mui/material/Drawer';
import Toolbar from '@mui/material/Toolbar';
import type { ReactNode } from 'react';
import { useUiStore } from '@/store/ui-store';
import type { SessionUser } from '@/types/auth';
import SidebarContent from './sidebar-content';
import ServerStatusBadge from './server-status-badge';
import TopBar, { DRAWER_WIDTH } from './top-bar';
import { RealtimeBridge } from '@/components/realtime/realtime-bridge';

/**
 * Coquille applicative authentifiée : barre latérale responsive
 * (permanente sur grand écran, tiroir sur mobile), barre supérieure
 * avec recherche et identité de l'utilisateur, zone de contenu
 * principale sur fond décoratif « blobs » légers.
 */
export default function AppShell({
  user,
  children,
}: {
  user: SessionUser;
  children: ReactNode;
}) {
  const mobileNavOpen = useUiStore((state) => state.mobileNavOpen);
  const closeMobileNav = useUiStore((state) => state.closeMobileNav);

  return (
    <Box
      className="flex min-h-screen"
      sx={{
        position: 'relative',
        '&::before, &::after': {
          content: '""',
          position: 'fixed',
          borderRadius: '50%',
          pointerEvents: 'none',
          zIndex: 0,
        },
        '&::before': {
          width: 340,
          height: 340,
          top: -140,
          left: -120,
          background:
            'radial-gradient(circle, rgba(31,174,116,0.12) 0%, rgba(31,174,116,0) 70%)',
        },
        '&::after': {
          width: 420,
          height: 420,
          bottom: -180,
          right: -140,
          background:
            'radial-gradient(circle, rgba(59,130,214,0.10) 0%, rgba(59,130,214,0) 70%)',
        },
      }}
    >
      <ServerStatusBadge />
      <RealtimeBridge />
      <TopBar user={user} />
      <Box
        component="nav"
        aria-label="Navigation"
        sx={{ width: { md: DRAWER_WIDTH }, flexShrink: { md: 0 } }}
      >
        <Drawer
          variant="temporary"
          open={mobileNavOpen}
          onClose={closeMobileNav}
          ModalProps={{ keepMounted: true }}
          sx={{
            display: { xs: 'block', md: 'none' },
            '& .MuiDrawer-paper': { width: DRAWER_WIDTH },
          }}
        >
          <SidebarContent roleCode={user.roleCode} />
        </Drawer>
        <Drawer
          variant="permanent"
          open
          sx={{
            display: { xs: 'none', md: 'block' },
            '& .MuiDrawer-paper': {
              width: DRAWER_WIDTH,
              borderRight: '1px solid rgba(30,36,48,0.06)',
              boxShadow: 'none',
              backgroundImage: 'none',
            },
          }}
        >
          <SidebarContent roleCode={user.roleCode} />
        </Drawer>
      </Box>
      <Box
        component="main"
        className="min-w-0 flex-1"
        sx={{ position: 'relative', zIndex: 1 }}
      >
        <Toolbar />
        <Box className="jo-fade-in p-4 md:p-6">{children}</Box>
      </Box>
    </Box>
  );
}
