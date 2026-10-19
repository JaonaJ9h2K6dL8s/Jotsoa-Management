import StockDashboard from '@/features/stock/dashboard';
import { requirePageRole } from '@/server/auth/guards';

export const metadata = { title: 'Stock' };

export default async function StockPage() {
  const user = await requirePageRole('chef_stock');
  const name = user.prenom ? `${user.prenom} ${user.nom}` : user.nom;
  return <StockDashboard name={name} />;
}
