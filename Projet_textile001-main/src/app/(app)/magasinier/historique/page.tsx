import HistoryTable from '@/features/magasinier/history-table';
import { requirePageRole } from '@/server/auth/guards';

export const metadata = { title: 'Historique et alertes du magasin' };

export default async function MagasinierHistoriquePage() {
  await requirePageRole('chef_magasinier');
  return <HistoryTable />;
}
