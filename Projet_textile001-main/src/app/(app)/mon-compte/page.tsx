import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Divider from '@mui/material/Divider';
import Typography from '@mui/material/Typography';
import { requirePageUser } from '@/server/auth/guards';
import MascotSettings from '@/components/mascot/mascot-settings';

/**
 * Paramètres du compte de l'utilisateur connecté.
 * Section « Ma mascotte » : préférences strictement personnelles,
 * enregistrées avec l'identifiant de la session côté serveur.
 */
export default async function MonComptePage() {
  const user = await requirePageUser();

  return (
    <Box className="mx-auto max-w-3xl">
      <Typography variant="h5" component="h1" gutterBottom sx={{ fontWeight: 800 }}>
        Paramètres du compte
      </Typography>
      <Typography color="text.secondary" gutterBottom>
        Connecté en tant que{' '}
        <strong>
          {user.prenom ? `${user.prenom} ${user.nom}` : user.nom}
        </strong>{' '}
        — {user.roleLabel}
      </Typography>

      <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 }, mt: 3 }}>
        <Typography variant="h6" component="h2" gutterBottom>
          Ma mascotte
        </Typography>
        <Typography variant="body2" color="text.secondary" paragraph>
          Personnalisez votre compagnon animé : chaque utilisateur garde ses
          propres préférences, indépendamment des autres comptes.
        </Typography>
        <Divider sx={{ mb: 3 }} />
        <MascotSettings roleCode={user.roleCode} />
      </Paper>
    </Box>
  );
}
