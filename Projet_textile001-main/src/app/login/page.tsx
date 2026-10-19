import Box from '@mui/material/Box';
import { redirect } from 'next/navigation';
import LoginForm from './login-form';
import ServerStatusBadge from '@/components/layout/server-status-badge';
import { getCurrentUser } from '@/server/auth/current-user';
import { homePathForRole } from '@/lib/permissions';
import { hasAnyAdmin } from '@/server/users/users-service';
import './login.css';

export const metadata = { title: 'Connexion' };

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) {
    redirect(
      user.mustChangePassword ? '/change-password' : homePathForRole(user.roleCode),
    );
  }

  return (
    <Box
      className="jm-root jm-grain flex min-h-screen items-stretch justify-center"
    >
      <LoginForm adminExists={hasAnyAdmin()} />
      <ServerStatusBadge />
    </Box>
  );
}
