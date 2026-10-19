import RetoucheDashboard from '@/features/retouche/dashboard';
import { requirePageRole } from '@/server/auth/guards';
import { getDashboard } from '@/server/retouche/dashboard';

export const metadata = { title: 'Retouche' };

export const dynamic = 'force-dynamic';

export default async function RetouchePage() {
  const user = await requirePageRole('retoucheur');
  const data = getDashboard({
    id: user.id,
    roleCode: user.roleCode,
  });
  const name = user.prenom ? `${user.prenom} ${user.nom}` : user.nom;
  return <RetoucheDashboard name={name} data={data} />;
}
