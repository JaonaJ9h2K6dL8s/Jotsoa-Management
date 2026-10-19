import PreparationsManager from '@/features/magasinier/preparations-manager';
import { requirePageRole } from '@/server/auth/guards';

export const metadata = { title: 'Préparation du stock' };

export default async function MagasinierPreparationsPage() {
  await requirePageRole('chef_magasinier');
  return <PreparationsManager />;
}
