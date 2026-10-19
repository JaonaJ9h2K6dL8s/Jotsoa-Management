import { requirePageRole } from '@/server/auth/guards';
import { ProductTypesManager } from '../catalogue-clients';

export const metadata = { title: 'Types de produits' };

export default async function ProductTypesPage() {
  await requirePageRole('admin');
  return <ProductTypesManager />;
}
