import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import LotsWorkflowManager from '@/features/coupe/workflow/lots-workflow-manager';
import { requirePageRole } from '@/server/auth/guards';

export const metadata = { title: 'Lots de coupe' };

export default async function CoupeLotsPage() {
  await requirePageRole('chef_coupe');
  return (
    <Stack spacing={2}>
      <Typography variant="h5" component="h1">
        Lots de coupe
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Suivi automatisé des lots : les données sont chargées depuis les
        commandes, les vérifications et le calcul du matelas sont proposés
        automatiquement. Seules les validations requièrent une action.
      </Typography>
      <LotsWorkflowManager />
    </Stack>
  );
}
