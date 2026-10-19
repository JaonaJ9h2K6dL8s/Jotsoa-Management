import type { ReactNode } from 'react';
import { requirePageRole } from '@/server/auth/guards';

/** Espace réservé au rôle chef de couture (vérification côté serveur). */
export default async function CoutureLayout({ children }: { children: ReactNode }) {
  await requirePageRole('chef_couture');
  return <>{children}</>;
}
