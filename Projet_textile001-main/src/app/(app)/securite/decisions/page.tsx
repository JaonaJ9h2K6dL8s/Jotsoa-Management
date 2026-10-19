import DecisionsManager from '@/features/securite/decisions-manager';
import { requirePageRole } from '@/server/auth/guards';

export const metadata = { title: 'Décisions et sorties' };

export default async function SecuriteDecisionsPage() {
  await requirePageRole('chef_securite');
  return <DecisionsManager />;
}
