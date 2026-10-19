import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import CodesLookup from '@/features/coupe/codes-lookup';
import { requirePageRole } from '@/server/auth/guards';

export const metadata = { title: 'Codes et QR — Coupe' };

export default async function CoupeCodesPage() {
  await requirePageRole('chef_coupe');
  return (
    <Stack spacing={2}>
      <Typography variant="h5" component="h1">
        Codes manuels et QR codes
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Recherche d&apos;un rouleau, d&apos;un lot ou d&apos;un paquet par code
        manuel ou par QR code. Les deux méthodes retrouvent le même
        enregistrement ; les permissions restent vérifiées côté serveur.
      </Typography>
      <CodesLookup />
    </Stack>
  );
}
