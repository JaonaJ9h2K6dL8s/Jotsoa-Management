import AssignmentsManager from '@/features/retouche/assignments-manager';
import { requirePageRole } from '@/server/auth/guards';

export const metadata = { title: 'Affectations — Retouche' };

export default async function RetoucheAffectationsPage() {
  await requirePageRole('retoucheur');
  return <AssignmentsManager />;
}
