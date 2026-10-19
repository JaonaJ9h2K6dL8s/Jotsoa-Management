import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import SewingManager from '@/features/admin/config/sewing-manager';
import { requirePageRole } from '@/server/auth/guards';

export const metadata = { title: 'Salles et lignes de couture' };

export default async function SewingConfigPage() {
  await requirePageRole('admin');
  return (
    <Stack spacing={2}>
      <Typography variant="h5" component="h1">
        Salles et lignes de couture
      </Typography>
      <Typography variant="body2" color="text.secondary">
        L&apos;entreprise dispose de trois salles de couture. Configurez les
        lignes de production de chaque salle ; une ligne appartient à une
        seule salle.
      </Typography>
      <SewingManager />
    </Stack>
  );
}
