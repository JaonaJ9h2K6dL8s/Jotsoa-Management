import type { ReactNode } from 'react';
import { requirePageRole } from '@/server/auth/guards';

/** Espace réservé au rôle chef sécurité (vérification côté serveur). */
export default async function SecuriteLayout({ children }: { children: ReactNode }) {
  await requirePageRole('chef_securite');
  return <>{children}</>;
}
