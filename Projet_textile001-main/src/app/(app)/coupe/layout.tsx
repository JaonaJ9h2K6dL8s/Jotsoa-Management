import type { ReactNode } from 'react';
import { requirePageRole } from '@/server/auth/guards';

/** Espace réservé au rôle chef de coupe (vérification côté serveur). */
export default async function CoupeLayout({ children }: { children: ReactNode }) {
  await requirePageRole('chef_coupe');
  return <>{children}</>;
}
