import DossiersManager from '@/features/magasinier/dossiers-manager';
import { requirePageRole } from '@/server/auth/guards';

export const metadata = { title: 'Dossiers de sortie' };

export default async function MagasinierDossiersPage() {
  await requirePageRole('chef_magasinier');
  return <DossiersManager />;
}
