/**
 * Référentiel des huit rôles métier.
 * Les codes techniques sont stables en base ; les libellés
 * affichés sont en français.
 */

export const ROLE_CODES = [
  'admin',
  'chef_coupe',
  'chef_couture',
  'controleur_qualite',
  'retoucheur',
  'chef_stock',
  'chef_magasinier',
  'chef_securite',
] as const;

export type RoleCode = (typeof ROLE_CODES)[number];

export const ROLE_LABELS: Record<RoleCode, string> = {
  admin: 'Administrateur',
  chef_coupe: 'Chef de coupe',
  chef_couture: 'Chef de couture',
  controleur_qualite: 'Contrôleur qualité',
  retoucheur: 'Retoucheur',
  chef_stock: 'Chef de stock',
  chef_magasinier: 'Chef magasinier',
  chef_securite: 'Chef sécurité',
};

export function isRoleCode(value: unknown): value is RoleCode {
  return (
    typeof value === 'string' &&
    (ROLE_CODES as readonly string[]).includes(value)
  );
}
