import ValidationsManager from '@/features/couture/validations-manager';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { requirePageRole } from '@/server/auth/guards';

export const metadata = { title: 'Validations & alertes — Couture' };

export default async function CoutureValidationsPage() {
  await requirePageRole('chef_couture');
  return (
    <Stack spacing={2}>
      <Typography variant="h5" component="h1">
        Secondes validations et alertes
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Les opérations sensibles (corrections de production, annulations de
        transferts) ne deviennent effectives qu’après approbation d’un autre
        utilisateur habilité. L’auteur d’une demande ne peut pas la traiter.
      </Typography>
      <ValidationsManager />
    </Stack>
  );
}
