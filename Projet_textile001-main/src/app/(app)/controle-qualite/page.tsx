import ControleQualiteDashboard from '@/features/controle-qualite/dashboard';
import { requirePageRole } from '@/server/auth/guards';
import { getDashboard } from '@/server/controle-qualite/dashboard';

export const metadata = { title: 'Contrôle qualité' };

export const dynamic = 'force-dynamic';

export default async function QualitePage() {
  const user = await requirePageRole('controleur_qualite');
  const data = getDashboard({
    id: user.id,
    roleCode: user.roleCode,
  });
  const name = user.prenom ? `${user.prenom} ${user.nom}` : user.nom;
  return <ControleQualiteDashboard name={name} data={data} />;
}
