import IncidentsManager from '@/features/couture/incidents-manager';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { requirePageRole } from '@/server/auth/guards';

export const metadata = { title: 'Incidents — Couture' };

export default async function CoutureIncidentsPage() {
  await requirePageRole('chef_couture');
  return (
    <Stack spacing={2}>
      <Typography variant="h5" component="h1">
        Interruptions et anomalies
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Une anomalie critique bloque automatiquement l’affectation concernée
        jusqu’à sa résolution.
      </Typography>
      <IncidentsManager />
    </Stack>
  );
}
