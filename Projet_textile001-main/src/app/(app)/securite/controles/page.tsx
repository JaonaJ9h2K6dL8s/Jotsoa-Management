import ControlesManager from '@/features/securite/controles-manager';
import { requirePageRole } from '@/server/auth/guards';

export const metadata = { title: 'Contrôles de sortie' };

export default async function SecuriteControlesPage() {
  await requirePageRole('chef_securite');
  return <ControlesManager />;
}
