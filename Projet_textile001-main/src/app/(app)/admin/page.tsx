import AdminDashboard from '@/features/admin/dashboard';
import { requirePageRole } from '@/server/auth/guards';

export const metadata = { title: 'Administration' };

export default async function AdminPage() {
  await requirePageRole('admin');
  return <AdminDashboard />;
}
