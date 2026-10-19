import type { ReactNode } from 'react';
import { requirePageRole } from '@/server/auth/guards';

/** Espace réservé au rôle chef magasinier (vérification côté serveur). */
export default async function MagasinierLayout({ children }: { children: ReactNode }) {
  await requirePageRole('chef_magasinier');
  return <>{children}</>;
}
