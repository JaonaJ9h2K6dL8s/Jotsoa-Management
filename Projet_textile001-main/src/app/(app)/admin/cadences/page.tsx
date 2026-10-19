import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import CadenceManager from '@/features/admin/config/cadence-manager';
import { requirePageRole } from '@/server/auth/guards';

export const metadata = { title: 'Cadences et objectifs' };

export default async function CadencesPage() {
  await requirePageRole('admin');
  return (
    <Stack spacing={2}>
      <Typography variant="h5" component="h1">
        Cadences et objectifs
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Une seule configuration active par contexte (type de produit, salle,
        ligne). À la lecture, le contexte le plus spécifique l&apos;emporte
        (ligne &gt; salle &gt; global).
      </Typography>
      <CadenceManager />
    </Stack>
  );
}
