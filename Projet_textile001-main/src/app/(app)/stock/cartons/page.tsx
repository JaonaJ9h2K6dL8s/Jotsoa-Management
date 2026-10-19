import CartonsManager from '@/features/stock/cartons-manager';
import { requirePageRole } from '@/server/auth/guards';

export const metadata = { title: 'Cartons et emplacements' };

export default async function StockCartonsPage() {
  await requirePageRole('chef_stock');
  return <CartonsManager />;
}
