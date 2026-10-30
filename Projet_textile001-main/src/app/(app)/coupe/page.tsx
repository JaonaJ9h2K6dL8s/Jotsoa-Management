import Box from '@mui/material/Box';
import Workspace from '@/interfaces/cutting/Workspace';
import { requirePageRole } from '@/server/auth/guards';

export const metadata = { title: 'Atelier Coupe' };

export const dynamic = 'force-dynamic';

export default async function CoupePage() {
  await requirePageRole('chef_coupe', 'admin');
  // Plein écran façon Illustrator : l'atelier occupe TOUTE la surface sous
  // la barre applicative DENSE du mode atelier (48 px). Les marges négatives
  // annulent le padding du shell — le canvas touche les bords de la fenêtre.
  return (
    <Box
      sx={{
        height: 'calc(100vh - 48px)',
        minHeight: 480,
        mx: { xs: '-16px', md: '-24px' },
        my: { xs: '-16px', md: '-24px' },
        overflow: 'hidden',
      }}
    >
      <Workspace />
    </Box>
  );
}
