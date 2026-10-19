import InterventionsManager from '@/features/retouche/interventions-manager';
import { requirePageRole } from '@/server/auth/guards';

export const metadata = { title: 'Interventions — Retouche' };

export default async function RetoucheInterventionsPage() {
  await requirePageRole('retoucheur');
  return <InterventionsManager />;
}
