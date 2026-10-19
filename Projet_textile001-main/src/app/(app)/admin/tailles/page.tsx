import { requirePageRole } from '@/server/auth/guards';
import { SizesManager } from '../catalogue-clients';

export const metadata = { title: 'Tailles' };

export default async function SizesPage() {
  await requirePageRole('admin');
  return <SizesManager />;
}
