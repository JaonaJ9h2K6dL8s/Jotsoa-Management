import ValidationsManager from '@/features/controle-qualite/validations-manager';
import { requirePageRole } from '@/server/auth/guards';

export const metadata = { title: 'Validations et alertes — Contrôle qualité' };

export default async function QualiteValidationsPage() {
  await requirePageRole('controleur_qualite');
  return <ValidationsManager />;
}
