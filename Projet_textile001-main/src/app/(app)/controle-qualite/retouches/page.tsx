import ReworkManager from '@/features/controle-qualite/rework-manager';
import { requirePageRole } from '@/server/auth/guards';

export const metadata = { title: 'Retouches et contrôles finaux — Contrôle qualité' };

export default async function QualiteRetouchesPage() {
  await requirePageRole('controleur_qualite');
  return <ReworkManager />;
}
