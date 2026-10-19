import type { ReactNode } from 'react';
import { requirePageRole } from '@/server/auth/guards';

/** Espace réservé au rôle chef de stock (vérification côté serveur). */
export default async function StockLayout({ children }: { children: ReactNode }) {
  await requirePageRole('chef_stock');
  return <>{children}</>;
}
