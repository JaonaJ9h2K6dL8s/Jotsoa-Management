import Box from '@mui/material/Box';
import Workspace from '@/interfaces/cutting/Workspace';
import { requirePageRole } from '@/server/auth/guards';

export const metadata = { title: 'Atelier Coupe' };

export const dynamic = 'force-dynamic';

export default async function CoupePage() {
  await requirePageRole('chef_coupe', 'admin');
  // Conteneur borné à la fenêtre (étape 10) : l'atelier occupe toute la
  // hauteur visible sans défilement de page — le canvas et les panneaux
  // gèrent leur propre défilement interne.
  return (
    <Box sx={{ height: 'calc(100vh - 112px)', minHeight: 560 }}>
      <Workspace />
    </Box>
  );
}
