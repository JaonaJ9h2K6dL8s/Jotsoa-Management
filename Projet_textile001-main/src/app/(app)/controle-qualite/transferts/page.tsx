import StockTransfersManager from '@/features/controle-qualite/stock-transfers-manager';
import { requirePageRole } from '@/server/auth/guards';

export const metadata = { title: 'Transferts stock — Contrôle qualité' };

export default async function QualiteTransfertsPage() {
  await requirePageRole('controleur_qualite');
  return <StockTransfersManager />;
}
