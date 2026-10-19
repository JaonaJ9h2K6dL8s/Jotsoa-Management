import PilotageClient from '@/features/admin/pilotage/pilotage-client';
import { requirePageRole } from '@/server/auth/guards';

export const metadata = { title: 'Rapports & pilotage' };

export default async function AdminRapportsPage() {
  await requirePageRole('admin');
  return <PilotageClient />;
}
