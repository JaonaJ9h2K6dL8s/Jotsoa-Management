import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import AppShell from '@/components/layout/app-shell';
import { requirePageUser } from '@/server/auth/guards';

/**
 * Layout de l'espace authentifié : vérifie la session côté serveur
 * à chaque navigation et force le changement de mot de passe initial.
 */
export default async function AuthenticatedLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await requirePageUser();
  if (user.mustChangePassword) {
    redirect('/change-password');
  }
  return <AppShell user={user}>{children}</AppShell>;
}
