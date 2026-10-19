import { requirePageRole } from '@/server/auth/guards';
import { ColorsManager } from '../catalogue-clients';

export const metadata = { title: 'Couleurs' };

export default async function ColorsPage() {
  await requirePageRole('admin');
  return <ColorsManager />;
}
