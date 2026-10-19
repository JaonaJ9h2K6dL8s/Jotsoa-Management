'use client';

import { AppRouterCacheProvider } from '@mui/material-nextjs/v15-appRouter';
import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import type { ReactNode } from 'react';
import { theme } from './theme';

/**
 * Intégration MUI v7 avec l'App Router :
 * - AppRouterCacheProvider : cache Emotion compatible SSR (React 19).
 * - enableCssLayer : place les styles MUI dans la couche `mui`,
 *   ce qui permet à Tailwind de rester maître de l'ordre des couches.
 */
export default function ThemeRegistry({ children }: { children: ReactNode }) {
  return (
    <AppRouterCacheProvider options={{ enableCssLayer: true }}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </AppRouterCacheProvider>
  );
}
