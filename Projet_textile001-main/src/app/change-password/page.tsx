import { redirect } from 'next/navigation';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import ChangePasswordForm from './change-password-form';
import ServerStatusBadge from '@/components/layout/server-status-badge';
import { getCurrentUser } from '@/server/auth/current-user';

export const metadata = { title: 'Changer le mot de passe' };

export default async function ChangePasswordPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }

  return (
    <Box className="flex min-h-screen items-center justify-center p-4">
      <ServerStatusBadge />
      <Box className="w-full max-w-md">
        <Typography variant="h5" component="h1" className="mb-1">
          Changement de mot de passe
        </Typography>
        <Typography variant="body2" color="text.secondary" className="mb-4">
          {user.mustChangePassword
            ? 'Pour des raisons de sécurité, vous devez définir un nouveau mot de passe avant de continuer.'
            : 'Définissez un nouveau mot de passe pour votre compte.'}
        </Typography>
        <ChangePasswordForm username={user.username} />
      </Box>
    </Box>
  );
}
