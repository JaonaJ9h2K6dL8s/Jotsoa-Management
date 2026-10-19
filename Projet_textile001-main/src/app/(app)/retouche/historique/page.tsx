import HistoryTable from '@/features/retouche/history-table';
import { requirePageRole } from '@/server/auth/guards';

export const metadata = { title: 'Historique et alertes — Retouche' };

export default async function RetoucheHistoriquePage() {
  await requirePageRole('retoucheur');
  return <HistoryTable />;
}
