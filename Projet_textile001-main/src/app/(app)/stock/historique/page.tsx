import HistoryTable from '@/features/stock/history-table';
import { requirePageRole } from '@/server/auth/guards';

export const metadata = { title: 'Historique et alertes du stock' };

export default async function StockHistoriquePage() {
  await requirePageRole('chef_stock');
  return <HistoryTable />;
}
