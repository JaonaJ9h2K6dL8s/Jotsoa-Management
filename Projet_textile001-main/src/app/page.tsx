import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import LoginIcon from '@mui/icons-material/Login';
import FactoryOutlinedIcon from '@mui/icons-material/PrecisionManufacturingOutlined';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import Paper from '@mui/material/Paper';
import TimelineOutlinedIcon from '@mui/icons-material/TimelineOutlined';
import Typography from '@mui/material/Typography';
import DatabaseStatus from '@/components/home/database-status';
import ModulesOverview from '@/components/home/modules-overview';
import AlteniaLogo from '@/components/home/altenia-logo';
import NetworkAccess from '@/components/home/network-access';
import { getCurrentUser } from '@/server/auth/current-user';
import { homePathForRole } from '@/lib/permissions';
import { redirect } from 'next/navigation';

const HIGHLIGHTS = [
  {
    icon: LockOutlinedIcon,
    title: 'Accès sécurisés',
    text: 'Rôles et permissions par métier.',
  },
  {
    icon: TimelineOutlinedIcon,
    title: 'Suivi en temps réel',
    text: 'Indicateurs et alertes de production.',
  },
  {
    icon: FactoryOutlinedIcon,
    title: 'Multi-ateliers',
    text: 'Coupe, couture, contrôle et stock.',
  },
];

/**
 * Page d'accueil publique — plein écran, deux panneaux :
 * à gauche l'identité Altenia et l'accès à la connexion,
 * à droite la grille des modules prévus (défilement interne).
 */
export default async function HomePage() {
  const user = await getCurrentUser();
  if (user) {
    const home = user.mustChangePassword
      ? '/change-password'
      : homePathForRole(user.roleCode);
    if (home !== '/') redirect(home);
  }

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: { xs: 'column', md: 'row' },
        height: { xs: 'auto', md: '100dvh' },
        overflow: { xs: 'visible', md: 'hidden' },
      }}
    >
      {/* Panneau gauche — identité + connexion */}
      <Box
        sx={{
          position: 'relative',
          overflow: 'hidden',
          width: { xs: '100%', md: '50%' },
          minHeight: { xs: 560, md: '100dvh' },
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          px: { xs: 3, md: 8 },
          py: { xs: 6, md: 4 },
          color: '#eef2fc',
          backgroundImage:
            'radial-gradient(700px 340px at 15% -8%, rgba(31,174,116,0.22) 0%, rgba(31,174,116,0) 55%), radial-gradient(520px 300px at 95% 115%, rgba(212,175,55,0.10) 0%, rgba(212,175,55,0) 60%), linear-gradient(150deg, #0a1633 0%, #13224a 55%, #1a2f63 100%)',
        }}
      >
        {/* Liseré doré supérieur */}
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '4px',
            background:
              'linear-gradient(90deg, rgba(212,175,55,0) 0%, rgba(212,175,55,.8) 50%, rgba(212,175,55,0) 100%)',
          }}
        />

        <AlteniaLogo size={104} />

        <Typography
          variant="caption"
          sx={{
            mt: 3,
            textTransform: 'uppercase',
            letterSpacing: '3px',
            fontWeight: 700,
            color: '#e9cf7e',
          }}
        >
          Altenia Technologie
        </Typography>
        <Typography
          variant="h3"
          component="h2"
          sx={{ fontWeight: 800, mt: 0.5, color: '#ffffff' }}
        >
          JO Management
        </Typography>
        <Typography
          sx={{ mt: 1.5, color: '#c9d6f0', textAlign: 'center', maxWidth: 460 }}
        >
          La plateforme complète de gestion pour l&apos;industrie textile — de
          la coupe à l&apos;expédition.
        </Typography>

        {/* Points forts */}
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr 1fr' },
            gap: 2.5,
            mt: 4,
          }}
        >
          {HIGHLIGHTS.map(({ icon: Icon, title, text }) => (
            <Box key={title} className="flex items-start gap-2" sx={{ maxWidth: 170 }}>
              <Box
                aria-hidden
                sx={{
                  width: 36,
                  height: 36,
                  flexShrink: 0,
                  borderRadius: '10px',
                  display: 'grid',
                  placeItems: 'center',
                  color: '#2ccf8f',
                  bgcolor: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.10)',
                }}
              >
                <Icon sx={{ fontSize: 19 }} />
              </Box>
              <Box>
                <Typography sx={{ fontWeight: 700, fontSize: 13.5, color: '#eef2fc' }}>
                  {title}
                </Typography>
                <Typography sx={{ fontSize: 12, color: '#9fb0d4' }}>
                  {text}
                </Typography>
              </Box>
            </Box>
          ))}
        </Box>

        <Button
          component={Link}
          href="/login"
          variant="contained"
          size="large"
          endIcon={<LoginIcon />}
          sx={{
            mt: 4.5,
            borderRadius: '999px',
            px: 5,
            py: 1.5,
            fontWeight: 700,
            color: '#06281c',
            bgcolor: '#2ccf8f',
            boxShadow: '0 14px 32px rgba(31,174,116,.35)',
            '&:hover': { bgcolor: '#3adf9f' },
          }}
        >
          Se connecter
        </Button>

        {/* Statut base de données */}
        <Paper
          elevation={4}
          sx={{
            mt: 3.5,
            borderRadius: '999px',
            px: 3,
            py: 1.25,
          }}
        >
          <DatabaseStatus />
        </Paper>

        <NetworkAccess />

        {/* Signature */}
        <Typography
          variant="caption"
          sx={{
            position: 'absolute',
            bottom: 18,
            left: 0,
            right: 0,
            textAlign: 'center',
            color: '#7386ad',
            letterSpacing: '1.6px',
          }}
        >
          ALTENIA TECHNOLOGIE — SOLUTIONS POUR L&apos;INDUSTRIE TEXTILE
        </Typography>
      </Box>

      {/* Panneau droit — modules prévus */}
      <Box
        sx={{
          width: { xs: '100%', md: '50%' },
          minHeight: { xs: 'auto', md: '100dvh' },
          bgcolor: 'background.default',
          overflowY: { xs: 'visible', md: 'auto' },
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <Box
          sx={{
            width: '100%',
            maxWidth: 720,
            px: { xs: 3, md: 5 },
            py: { xs: 5, md: 6 },
          }}
        >
          <ModulesOverview />
        </Box>
      </Box>
    </Box>
  );
}
