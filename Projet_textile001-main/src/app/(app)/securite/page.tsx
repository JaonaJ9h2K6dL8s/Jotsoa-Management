import SecuriteDashboard from '@/features/securite/dashboard';
import { requirePageRole } from '@/server/auth/guards';

export const metadata = { title: 'Sécurité' };

export default async function SecuritePage() {
  const user = await requirePageRole('chef_securite');
  const name = user.prenom ? `${user.prenom} ${user.nom}` : user.nom;
  return <SecuriteDashboard name={name} />;
}
