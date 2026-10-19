import TransfersManager from '@/features/couture/transfers-manager';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { requirePageRole } from '@/server/auth/guards';

export const metadata = { title: 'Transferts CQ — Couture' };

export default async function CoutureTransfersPage() {
  await requirePageRole('chef_couture');
  return (
    <Stack spacing={2}>
      <Typography variant="h5" component="h1">
        Transferts vers le contrôle qualité
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Seules les quantités réellement cousues et non transférées peuvent
        partir. L’annulation d’un transfert confirmé passe par une seconde
        validation.
      </Typography>
      <TransfersManager />
    </Stack>
  );
}
