import RoomsManager from '@/features/couture/rooms-manager';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { requirePageRole } from '@/server/auth/guards';

export const metadata = { title: 'Salles et lignes — Couture' };

export default async function CoutureRoomsPage() {
  await requirePageRole('chef_couture');
  return (
    <Stack spacing={2}>
      <Typography variant="h5" component="h1">
        Salles et lignes de couture
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Les salles et lignes viennent de la base de données. Une ligne ou
        une salle occupée par des affectations actives ne peut pas être
        désactivée.
      </Typography>
      <RoomsManager />
    </Stack>
  );
}
