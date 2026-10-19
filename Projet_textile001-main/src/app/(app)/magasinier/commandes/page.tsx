import OrdersManager from '@/features/magasinier/orders-manager';
import { requirePageRole } from '@/server/auth/guards';

export const metadata = { title: 'Commandes importées' };

export default async function MagasinierCommandesPage() {
  await requirePageRole('chef_magasinier');
  return <OrdersManager />;
}
