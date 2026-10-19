import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ZoneManager from '@/features/admin/config/zone-manager';
import { requirePageRole } from '@/server/auth/guards';

export const metadata = { title: 'Zones de retouche' };

export default async function ReworkZonesPage() {
  await requirePageRole('admin');
  return (
    <Stack spacing={2}>
      <Typography variant="h5" component="h1">
        Zones de retouche
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Zones utilisées par le futur module Retouche pour localiser les
        défauts. Chaque zone peut être associée à un ou plusieurs types de
        produits.
      </Typography>
      <ZoneManager />
    </Stack>
  );
}
