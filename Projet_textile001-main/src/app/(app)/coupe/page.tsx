import CoupeDashboard from '@/features/coupe/dashboard';
import { requirePageRole } from '@/server/auth/guards';
import { getDashboard } from '@/server/coupe/dashboard';

export const metadata = { title: 'Coupe' };

export const dynamic = 'force-dynamic';

export default async function CoupePage() {
  const user = await requirePageRole('chef_coupe');
  const data = getDashboard({
    id: user.id,
    roleCode: user.roleCode,
  });
  const name = user.prenom ? `${user.prenom} ${user.nom}` : user.nom;
  return <CoupeDashboard name={name} data={data} />;
}
