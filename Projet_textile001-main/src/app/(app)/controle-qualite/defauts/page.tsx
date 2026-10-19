import DefautsManager from '@/features/controle-qualite/defauts-manager';
import { requirePageRole } from '@/server/auth/guards';

export const metadata = { title: 'Défauts et décisions — Contrôle qualité' };

export default async function QualiteDefautsPage() {
  await requirePageRole('controleur_qualite');
  return <DefautsManager />;
}
