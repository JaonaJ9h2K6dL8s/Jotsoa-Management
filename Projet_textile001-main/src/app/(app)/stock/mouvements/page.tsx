import MovementsManager from '@/features/stock/movements-manager';
import WastePanel from '@/features/stock/waste-panel';
import { requirePageRole } from '@/server/auth/guards';

export const metadata = { title: 'Mouvements de stock' };

export default async function StockMouvementsPage() {
  await requirePageRole('chef_stock');
  return (
    <>
      <MovementsManager />
      <WastePanel />
    </>
  );
}
