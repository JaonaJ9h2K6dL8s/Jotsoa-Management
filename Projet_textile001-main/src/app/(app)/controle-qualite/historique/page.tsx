import HistoryTable from '@/features/controle-qualite/history-table';
import { requirePageRole } from '@/server/auth/guards';

export const metadata = { title: 'Historique — Contrôle qualité' };

export default async function QualiteHistoriquePage() {
  await requirePageRole('controleur_qualite');
  return <HistoryTable />;
}
