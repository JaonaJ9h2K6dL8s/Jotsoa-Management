import ControlsManager from '@/features/controle-qualite/controls-manager';
import { requirePageRole } from '@/server/auth/guards';

export const metadata = { title: 'Contrôles — Contrôle qualité' };

export default async function QualiteControlesPage() {
  await requirePageRole('controleur_qualite');
  return <ControlsManager />;
}
