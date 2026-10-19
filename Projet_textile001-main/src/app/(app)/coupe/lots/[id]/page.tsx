import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import LotWorkflowDetail from '@/features/coupe/workflow/lot-workflow-detail';
import { requirePageRole } from '@/server/auth/guards';

export const metadata = { title: 'Fiche du lot — Coupe' };

export default async function CoupeLotDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePageRole('chef_coupe');
  const { id } = await params;
  return (
    <Stack spacing={2}>
      <Typography variant="h5" component="h1">
        Fiche du lot
      </Typography>
      <LotWorkflowDetail lotId={Number(id)} />
    </Stack>
  );
}
