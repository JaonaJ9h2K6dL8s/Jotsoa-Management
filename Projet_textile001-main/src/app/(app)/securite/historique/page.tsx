import SecuriteHistoryTable from '@/features/securite/history-table';
import { requirePageRole } from '@/server/auth/guards';

export const metadata = { title: 'Historique et alertes sécurité' };

export default async function SecuriteHistoriquePage() {
  await requirePageRole('chef_securite');
  return <SecuriteHistoryTable />;
}
