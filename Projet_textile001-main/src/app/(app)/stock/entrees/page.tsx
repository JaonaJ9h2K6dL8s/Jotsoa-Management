import EntriesManager from '@/features/stock/entries-manager';
import { requirePageRole } from '@/server/auth/guards';

export const metadata = { title: 'Entrées du contrôle qualité' };

export default async function StockEntreesPage() {
  await requirePageRole('chef_stock');
  return <EntriesManager />;
}
