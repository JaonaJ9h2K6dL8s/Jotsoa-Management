import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import SettingsForm from '@/features/admin/config/settings-form';
import { requirePageRole } from '@/server/auth/guards';

export const metadata = { title: 'Paramètres généraux' };

export default async function SettingsPage() {
  await requirePageRole('admin');
  return (
    <Stack spacing={2} className="max-w-2xl">
      <Typography variant="h5" component="h1">
        Paramètres généraux
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Configuration de l&apos;entreprise et préférences d&apos;affichage
        partagées par les modules.
      </Typography>
      <SettingsForm />
    </Stack>
  );
}
