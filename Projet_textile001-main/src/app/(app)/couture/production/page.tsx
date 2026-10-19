import ProductionsManager from '@/features/couture/productions-manager';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { requirePageRole } from '@/server/auth/guards';

export const metadata = { title: 'Production — Couture' };

export default async function CoutureProductionPage() {
  await requirePageRole('chef_couture');
  return (
    <Stack spacing={2}>
      <Typography variant="h5" component="h1">
        Production réellement cousue
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Plusieurs enregistrements sont possibles par affectation. La
        correction ou l’annulation d’une production exige une seconde
        validation par un autre utilisateur habilité.
      </Typography>
      <ProductionsManager />
    </Stack>
  );
}
