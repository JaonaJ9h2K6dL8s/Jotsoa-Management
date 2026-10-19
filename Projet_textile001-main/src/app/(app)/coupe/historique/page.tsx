import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import HistoryTable from '@/features/coupe/history-table';
import { requirePageRole } from '@/server/auth/guards';

export const metadata = { title: 'Historique — Coupe' };

export default async function CoupeHistoryPage() {
  await requirePageRole('chef_coupe');
  return (
    <Stack spacing={2}>
      <Typography variant="h5" component="h1">
        Historique des opérations
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Traçabilité complète des opérations de coupe : créations, corrections,
        validations, déchets et transferts. Cet historique n&apos;est ni
        modifiable ni supprimable.
      </Typography>
      <HistoryTable />
    </Stack>
  );
}
