import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import WasteManager from '@/features/coupe/waste-manager';
import { requirePageRole } from '@/server/auth/guards';

export const metadata = { title: 'Déchets et chutes — Coupe' };

export default async function CoupeWastePage() {
  await requirePageRole('chef_coupe');
  return (
    <Stack spacing={2}>
      <Typography variant="h5" component="h1">
        Déchets et chutes
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Déclarations distinctes des pièces coupées. Aucune déclaration n&apos;est
        supprimée : tout est conservé pour la traçabilité.
      </Typography>
      <WasteManager />
    </Stack>
  );
}
