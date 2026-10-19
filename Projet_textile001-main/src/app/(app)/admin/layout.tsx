import type { ReactNode } from 'react';
import { requirePageRole } from '@/server/auth/guards';

/** Espace réservé au rôle administrateur (vérification côté serveur). */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requirePageRole('admin');
  return <>{children}</>;
}
