import ReceptionsManager from '@/features/couture/receptions-manager';
import { requirePageRole } from '@/server/auth/guards';

export const metadata = { title: 'Réceptions Coupe — Couture' };

export default async function CoutureReceptionsPage() {
  await requirePageRole('chef_couture');
  return (
    <ReceptionsManager />
  );
}
