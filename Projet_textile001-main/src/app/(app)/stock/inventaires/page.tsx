import AdjustmentsPanel from '@/features/stock/adjustments-panel';
import InventoriesManager from '@/features/stock/inventories-manager';
import { requirePageRole } from '@/server/auth/guards';

export const metadata = { title: 'Inventaires physiques' };

export default async function StockInventairesPage() {
  await requirePageRole('chef_stock');
  return (
    <>
      <InventoriesManager />
      <AdjustmentsPanel />
    </>
  );
}
