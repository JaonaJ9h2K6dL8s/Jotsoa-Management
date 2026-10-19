import type { ReactNode } from 'react';
import { requirePageRole } from '@/server/auth/guards';

/** Espace réservé au rôle retoucheur (vérification côté serveur). */
export default async function RetoucheLayout({ children }: { children: ReactNode }) {
  await requirePageRole('retoucheur');
  return <>{children}</>;
}
