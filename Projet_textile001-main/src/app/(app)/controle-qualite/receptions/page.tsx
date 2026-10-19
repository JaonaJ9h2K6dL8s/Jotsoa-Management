import ReceptionsCqManager from '@/features/controle-qualite/receptions-manager';
import { requirePageRole } from '@/server/auth/guards';

export const metadata = { title: 'Réceptions couture — Contrôle qualité' };

export default async function QualiteReceptionsPage() {
  await requirePageRole('controleur_qualite');
  return <ReceptionsCqManager />;
}
