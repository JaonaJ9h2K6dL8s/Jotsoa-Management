import ReturnsManager from '@/features/retouche/returns-manager';
import { requirePageRole } from '@/server/auth/guards';

export const metadata = { title: 'Retours CQ et rebuts — Retouche' };

export default async function RetoucheRetoursPage() {
  await requirePageRole('retoucheur');
  return <ReturnsManager />;
}
