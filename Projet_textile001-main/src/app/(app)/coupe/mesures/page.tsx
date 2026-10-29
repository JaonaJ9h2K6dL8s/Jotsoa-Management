import MeasurementSessions from '@/interfaces/cutting/MeasurementSessions';
import { requirePageRole } from '@/server/auth/guards';

export const metadata = { title: 'Mesures de coupe — Atelier Coupe' };

export const dynamic = 'force-dynamic';

export default async function CoupeMesuresPage() {
  await requirePageRole('chef_coupe');
  return <MeasurementSessions />;
}
