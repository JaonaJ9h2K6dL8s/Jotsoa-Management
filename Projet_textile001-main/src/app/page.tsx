import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import DatabaseStatus from '@/components/home/database-status';
import ModulesOverview from '@/components/home/modules-overview';
import { getCurrentUser } from '@/server/auth/current-user';
import { homePathForRole } from '@/lib/permissions';
import { redirect } from 'next/navigation';

export default async function HomePage() {
  const user = await getCurrentUser();
  if (user) {
    redirect(user.mustChangePassword ? '/change-password' : homePathForRole(user.roleCode));
  }

  return (
    <Stack spacing={4} className="mx-auto max-w-3xl">
      <Paper variant="outlined" className="p-6">
        <Stack spacing={2}>
          <div>
            <Typography variant="h5" component="h2" gutterBottom>
              JO Management
            </Typography>
            <Typography color="text.secondary">
              Gestion intégrée de l’entreprise — plateforme de gestion pour
              l’entreprise textile.{' '}
              <Link href="/login" underline="hover">
                Se connecter
              </Link>
            </Typography>
          </div>
          <DatabaseStatus />
        </Stack>
      </Paper>
      <ModulesOverview />
    </Stack>
  );
}
