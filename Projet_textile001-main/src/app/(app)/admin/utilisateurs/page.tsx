import UsersManager from '@/features/admin/users-manager';
import { requirePageRole } from '@/server/auth/guards';

export const metadata = { title: 'Utilisateurs' };

export default async function UsersPage() {
  await requirePageRole('admin');
  return <UsersManager />;
}
