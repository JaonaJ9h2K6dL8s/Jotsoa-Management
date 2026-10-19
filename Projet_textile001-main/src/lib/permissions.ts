import type { RoleCode } from '@/lib/roles';

/**
 * Autorisations centralisées : espace de travail et navigation de
 * chaque rôle. Données pures partagées serveur/client — les vérifications
 * réelles restent effectuées côté serveur (guards + layouts).
 */

export interface WorkspaceDefinition {
  path: string;
  title: string;
  subtitle: string;
}

export const WORKSPACES: Record<RoleCode, WorkspaceDefinition> = {
  admin: {
    path: '/admin',
    title: 'Administration',
    subtitle: "Tableau de bord global de l'entreprise",
  },
  chef_coupe: {
    path: '/coupe',
    title: 'Coupe',
    subtitle: 'Suivi des opérations de coupe',
  },
  chef_couture: {
    path: '/couture',
    title: 'Couture',
    subtitle: 'Suivi des salles et lignes de couture',
  },
  controleur_qualite: {
    path: '/controle-qualite',
    title: 'Contrôle qualité',
    subtitle: 'Inspection et orientation des produits',
  },
  retoucheur: {
    path: '/retouche',
    title: 'Retouche',
    subtitle: 'Correction des pièces présentant des défauts',
  },
  chef_stock: {
    path: '/stock',
    title: 'Stock',
    subtitle: 'Cartons, emplacements et mouvements',
  },
  chef_magasinier: {
    path: '/magasinier',
    title: 'Magasin',
    subtitle: 'Préparation des commandes et sorties',
  },
  chef_securite: {
    path: '/securite',
    title: 'Sécurité',
    subtitle: 'Vérification des sorties d’usine',
  },
};

export function homePathForRole(role: RoleCode): string {
  return WORKSPACES[role].path;
}

export type NavIconKey =
  | 'dashboard'
  | 'users'
  | 'settings'
  | 'produits'
  | 'couleurs'
  | 'tailles'
  | 'zones'
  | 'defauts'
  | 'coupe'
  | 'couture'
  | 'cadences'
  | 'qualite'
  | 'retouche'
  | 'stock'
  | 'magasinier'
  | 'securite'
  | 'codes';

export interface NavItem {
  label: string;
  iconKey: NavIconKey;
  href?: string;
  enabled: boolean;
}

/** Navigation par rôle. Les éléments désactivés correspondent aux modules à venir. */
export const NAV_BY_ROLE: Record<RoleCode, NavItem[]> = {
  admin: [
    { label: 'Tableau de bord', iconKey: 'dashboard', href: '/admin', enabled: true },
    { label: 'Rapports & pilotage', iconKey: 'settings', href: '/admin/rapports', enabled: true },
    { label: 'Utilisateurs', iconKey: 'users', href: '/admin/utilisateurs', enabled: true },
    { label: 'Produits', iconKey: 'produits', href: '/admin/produits', enabled: true },
    { label: 'Couleurs', iconKey: 'couleurs', href: '/admin/couleurs', enabled: true },
    { label: 'Tailles', iconKey: 'tailles', href: '/admin/tailles', enabled: true },
    { label: 'Zones de retouche', iconKey: 'zones', href: '/admin/zones-retouche', enabled: true },
    { label: 'Défauts qualité', iconKey: 'defauts', href: '/admin/defauts', enabled: true },
    { label: 'Salles et lignes', iconKey: 'couture', href: '/admin/couture', enabled: true },
    { label: 'Cadences', iconKey: 'cadences', href: '/admin/cadences', enabled: true },
    { label: 'Paramètres', iconKey: 'settings', href: '/admin/parametres', enabled: true },
  ],
  chef_coupe: [
    { label: 'Tableau de bord', iconKey: 'dashboard', href: '/coupe', enabled: true },
    { label: 'Rouleaux', iconKey: 'coupe', href: '/coupe/rouleaux', enabled: true },
    { label: 'Lots de coupe', iconKey: 'couture', href: '/coupe/lots', enabled: true },
    { label: 'Fiches techniques', iconKey: 'produits', href: '/coupe/fiches', enabled: true },
    { label: 'Préparation & patrons vérifiés', iconKey: 'coupe', href: '/coupe/preparation', enabled: true },
    { label: 'Marker & patrons', iconKey: 'produits', href: '/coupe/marker', enabled: true },
    { label: 'Tickets QR', iconKey: 'codes', href: '/coupe/tickets', enabled: true },
    { label: 'Déchets et chutes', iconKey: 'retouche', href: '/coupe/dechets', enabled: true },
    { label: 'Codes et QR', iconKey: 'qualite', href: '/coupe/codes', enabled: true },
    { label: 'Historique', iconKey: 'settings', href: '/coupe/historique', enabled: true },
  ],
  chef_couture: [
    { label: 'Tableau de bord', iconKey: 'dashboard', href: '/couture', enabled: true },
    { label: 'Réceptions Coupe', iconKey: 'coupe', href: '/couture/receptions', enabled: true },
    { label: 'Affectations', iconKey: 'couture', href: '/couture/affectations', enabled: true },
    { label: 'Production', iconKey: 'cadences', href: '/couture/production', enabled: true },
    { label: 'Salles et lignes', iconKey: 'settings', href: '/couture/salles', enabled: true },
    { label: 'Incidents', iconKey: 'retouche', href: '/couture/incidents', enabled: true },
    { label: 'Transferts CQ', iconKey: 'qualite', href: '/couture/transferts', enabled: true },
    { label: 'Validations & alertes', iconKey: 'securite', href: '/couture/validations', enabled: true },
    { label: 'Historique', iconKey: 'magasinier', href: '/couture/historique', enabled: true },
  ],
  controleur_qualite: [
    { label: 'Tableau de bord', iconKey: 'dashboard', href: '/controle-qualite', enabled: true },
    { label: 'Réceptions couture', iconKey: 'coupe', href: '/controle-qualite/receptions', enabled: true },
    { label: 'Contrôles', iconKey: 'qualite', href: '/controle-qualite/controles', enabled: true },
    { label: 'Défauts et décisions', iconKey: 'defauts', href: '/controle-qualite/defauts', enabled: true },
    { label: 'Retouches et contrôles finaux', iconKey: 'retouche', href: '/controle-qualite/retouches', enabled: true },
    { label: 'Transferts stock', iconKey: 'stock', href: '/controle-qualite/transferts', enabled: true },
    { label: 'Validations & alertes', iconKey: 'securite', href: '/controle-qualite/validations', enabled: true },
    { label: 'Historique', iconKey: 'settings', href: '/controle-qualite/historique', enabled: true },
  ],
  retoucheur: [
    { label: 'Tableau de bord', iconKey: 'dashboard', href: '/retouche', enabled: true },
    { label: 'Demandes de retouche', iconKey: 'retouche', href: '/retouche/demandes', enabled: true },
    { label: 'Affectations', iconKey: 'coupe', href: '/retouche/affectations', enabled: true },
    { label: 'Interventions', iconKey: 'qualite', href: '/retouche/interventions', enabled: true },
    { label: 'Retours CQ & rebuts', iconKey: 'stock', href: '/retouche/retours', enabled: true },
    { label: 'Historique & alertes', iconKey: 'settings', href: '/retouche/historique', enabled: true },
  ],
  chef_stock: [
    { label: 'Tableau de bord', iconKey: 'dashboard', href: '/stock', enabled: true },
    { label: 'Entrées du contrôle qualité', iconKey: 'stock', href: '/stock/entrees', enabled: true },
    { label: 'Cartons et emplacements', iconKey: 'coupe', href: '/stock/cartons', enabled: true },
    { label: 'Mouvements et stock', iconKey: 'qualite', href: '/stock/mouvements', enabled: true },
    { label: 'Inventaires', iconKey: 'retouche', href: '/stock/inventaires', enabled: true },
    { label: 'Historique & alertes', iconKey: 'settings', href: '/stock/historique', enabled: true },
  ],
  chef_magasinier: [
    { label: 'Tableau de bord', iconKey: 'dashboard', href: '/magasinier', enabled: true },
    { label: 'Import des commandes PDF', iconKey: 'magasinier', href: '/magasinier/import', enabled: true },
    { label: 'Commandes importées', iconKey: 'coupe', href: '/magasinier/commandes', enabled: true },
    { label: 'Préparation du stock', iconKey: 'stock', href: '/magasinier/preparations', enabled: true },
    { label: 'Dossiers de sortie', iconKey: 'qualite', href: '/magasinier/dossiers', enabled: true },
    { label: 'Historique & alertes', iconKey: 'settings', href: '/magasinier/historique', enabled: true },
  ],
  chef_securite: [
    { label: 'Tableau de bord', iconKey: 'dashboard', href: '/securite', enabled: true },
    { label: 'Contrôles de sortie', iconKey: 'securite', href: '/securite/controles', enabled: true },
    { label: 'Anomalies', iconKey: 'qualite', href: '/securite/anomalies', enabled: true },
    { label: 'Décisions et sorties', iconKey: 'magasinier', href: '/securite/decisions', enabled: true },
    { label: 'Historique & alertes', iconKey: 'settings', href: '/securite/historique', enabled: true },
  ],
};
