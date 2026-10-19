import HistoryTable from '@/features/couture/history-table';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { requirePageRole } from '@/server/auth/guards';

export const metadata = { title: 'Historique — Couture' };

export default async function CoutureHistoryPage() {
  await requirePageRole('chef_couture');
  return (
    <Stack spacing={2}>
      <Typography variant="h5" component="h1">
        Historique des opérations de couture
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Toutes les opérations importantes sont tracées : réceptions,
        affectations, productions, corrections, incidents, transferts,
        validations et alertes.
      </Typography>
      <HistoryTable />
    </Stack>
  );
}
