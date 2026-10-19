import ImportManager from '@/features/magasinier/import-manager';
import { requirePageRole } from '@/server/auth/guards';

export const metadata = { title: 'Import des commandes PDF' };

export default async function MagasinierImportPage() {
  await requirePageRole('chef_magasinier');
  return <ImportManager />;
}
