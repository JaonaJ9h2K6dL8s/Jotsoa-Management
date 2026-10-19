import { requirePageRole } from '@/server/auth/guards';
import FichesManager from '@/features/coupe/fiches/fiches-manager';

export const metadata = { title: 'Fiches techniques' };

export default async function FichesPage() {
  await requirePageRole('chef_coupe');
  return <FichesManager />;
}
