import type { ReactNode } from 'react';
import { requirePageRole } from '@/server/auth/guards';

/** Espace réservé au rôle contrôleur qualité (vérification côté serveur). */
export default async function QualiteLayout({ children }: { children: ReactNode }) {
  await requirePageRole('controleur_qualite');
  return <>{children}</>;
}
