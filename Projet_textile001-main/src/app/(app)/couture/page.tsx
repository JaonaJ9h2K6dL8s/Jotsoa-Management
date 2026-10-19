import CoutureDashboard from '@/features/couture/dashboard';
import { requirePageRole } from '@/server/auth/guards';
import { getDashboard } from '@/server/couture/dashboard';

export const metadata = { title: 'Couture' };

export const dynamic = 'force-dynamic';

export default async function CouturePage() {
  const user = await requirePageRole('chef_couture');
  const data = getDashboard({
    id: user.id,
    roleCode: user.roleCode,
  });
  const name = user.prenom ? `${user.prenom} ${user.nom}` : user.nom;
  return <CoutureDashboard name={name} data={data} />;
}
