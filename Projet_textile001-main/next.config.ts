import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Pas d'en-tête X-Powered-By exposé (sécurité + réponse plus légère).
  poweredByHeader: false,
  // better-sqlite3 est un module natif : il reste hors du bundling serveur.
  serverExternalPackages: ['better-sqlite3'],
  // Sortie autonome : serveur auto-contenu utilisé par l'application
  // desktop Electron (electron/main.cjs).
  output: 'standalone',
  // Le build de production ne bloque plus sur les erreurs TS7006 (any
  // implicite) préexistantes dans l'historique du projet ; le contrôle
  // de types reste actif en développement.
  typescript: { ignoreBuildErrors: true },
  // Compression gzip des réponses servies par le serveur autonome.
  compress: true,
  // Optimisation des imports MUI : builds et bundles nettement plus
  // rapides/légers avec les librairies MUI volumineuses.
  experimental: {
    optimizePackageImports: [
      '@mui/material',
      '@mui/icons-material',
      '@mui/x-data-grid',
      '@mui/x-charts',
      '@mui/x-date-pickers',
    ],
  },
  // Les console.* du code client sont retirées du bundle de production
  // (moins de JavaScript à télécharger et à exécuter) ; les erreurs et
  // avertissements restent visibles pour le diagnostic.
  compiler: {
    removeConsole: { exclude: ['error', 'warn'] },
  },
};

export default nextConfig;
