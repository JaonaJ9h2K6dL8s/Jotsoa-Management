import AffectationsManager from '@/features/couture/affectations-manager';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { requirePageRole } from '@/server/auth/guards';

export const metadata = { title: 'Affectations — Couture' };

export default async function CoutureAssignmentsPage() {
  await requirePageRole('chef_couture');
  return (
    <Stack spacing={2}>
      <Typography variant="h5" component="h1">
        Affectation des lots aux salles et lignes
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Les affectations ne peuvent jamais dépasser les quantités réellement
        disponibles (reçues − contestées − déjà affectées).
      </Typography>
      <AffectationsManager />
    </Stack>
  );
}
