import RequestsManager from '@/features/retouche/requests-manager';
import { requirePageRole } from '@/server/auth/guards';

export const metadata = { title: 'Demandes de retouche' };

export default async function RetoucheDemandesPage() {
  await requirePageRole('retoucheur');
  return <RequestsManager />;
}
