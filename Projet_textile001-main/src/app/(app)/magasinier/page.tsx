import MagasinierDashboard from '@/features/magasinier/dashboard';
import { requirePageRole } from '@/server/auth/guards';

export const metadata = { title: 'Magasin' };

export default async function MagasinierPage() {
  const user = await requirePageRole('chef_magasinier');
  const name = user.prenom ? `${user.prenom} ${user.nom}` : user.nom;
  return <MagasinierDashboard name={name} />;
}
