import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import DefectManager from '@/features/admin/config/defect-manager';
import { requirePageRole } from '@/server/auth/guards';

export const metadata = { title: 'Défauts qualité' };

export default async function DefectsPage() {
  await requirePageRole('admin');
  return (
    <Stack spacing={2}>
      <Typography variant="h5" component="h1">
        Défauts qualité
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Catalogue des défauts constatés au contrôle qualité. Chaque défaut
        peut être associé aux types de produits et zones de retouche
        concernés, selon sa pertinence.
      </Typography>
      <DefectManager />
    </Stack>
  );
}
