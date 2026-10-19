import AnomaliesManager from '@/features/securite/anomalies-manager';
import { requirePageRole } from '@/server/auth/guards';

export const metadata = { title: 'Anomalies de sortie' };

export default async function SecuriteAnomaliesPage() {
  await requirePageRole('chef_securite');
  return <AnomaliesManager />;
}
