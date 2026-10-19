import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import RollsManager from '@/features/coupe/rolls-manager';
import { requirePageRole } from '@/server/auth/guards';

export const metadata = { title: 'Rouleaux — Coupe' };

export default async function CoupeRollsPage() {
  await requirePageRole('chef_coupe');
  return (
    <Stack spacing={2}>
      <Typography variant="h5" component="h1">
        Rouleaux de tissu
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Réception et suivi des rouleaux. Le poids initial est obligatoire entre
        9 et 30 kg ; toute correction est historisée avec son motif.
      </Typography>
      <RollsManager />
    </Stack>
  );
}
