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
import MascotBanner from '@/components/mascot/mascot-banner';
import { homePathForRole } from '@/lib/permissions';

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
  const sidebarCollapsed = useUiStore((state) => state.sidebarCollapsed);

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
          width: 380,
          height: 380,
          top: -160,
          left: -130,
          background:
            'radial-gradient(circle, rgba(14,107,68,0.12) 0%, rgba(14,107,68,0) 70%)',
        },
        '&::after': {
          width: 460,
          height: 460,
          bottom: -200,
          right: -160,
          background:
            'radial-gradient(circle, rgba(169,129,46,0.10) 0%, rgba(169,129,46,0) 70%)',
        },
      }}
    >
      <ServerStatusBadge />
      <RealtimeBridge />
      <TopBar user={user} />
      <Box
        component="nav"
        aria-label="Navigation"
        sx={{
          width: { md: sidebarCollapsed ? 0 : DRAWER_WIDTH },
          flexShrink: { md: 0 },
          overflow: { md: 'hidden' },
          transition: { md: 'width 220ms ease' },
        }}
      >
        <Drawer
          variant="temporary"
          open={mobileNavOpen}
          onClose={closeMobileNav}
          ModalProps={{ keepMounted: true }}
          sx={{
            display: { xs: 'block', md: 'none' },
            '& .MuiDrawer-paper': {
              width: DRAWER_WIDTH,
              backgroundImage: 'linear-gradient(180deg, #0d1410 0%, #0a0f0c 100%)',
              borderRight: '1px solid rgba(216,196,154,0.16)',
            },
          }}
        >
          <SidebarContent roleCode={user.roleCode} />
        </Drawer>
        {!sidebarCollapsed && (
          <Drawer
            variant="permanent"
            open
            sx={{
              display: { xs: 'none', md: 'block' },
              '& .MuiDrawer-paper': {
                width: DRAWER_WIDTH,
                borderRight: '1px solid rgba(216,196,154,0.16)',
                boxShadow: 'none',
                backgroundImage:
                  'linear-gradient(180deg, #0d1410 0%, #0a0f0c 100%)',
              },
            }}
          >
            <SidebarContent roleCode={user.roleCode} />
          </Drawer>
        )}
      </Box>
      <Box
        component="main"
        className="min-w-0 flex-1"
        sx={{ position: 'relative', zIndex: 1 }}
      >
        <Toolbar />
        <Box className="jo-fade-in p-4 md:p-6">
          <MascotBanner homePath={homePathForRole(user.roleCode)} />
          {children}
        </Box>
      </Box>
    </Box>
  );
}
