import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

/**
 * Logo Altenia Technologie recréé en composant (cercle blanc, mot
 * « Altenia » souligné, mention « Technologie »), avec un liseré doré.
 * Aucune ressource externe : rendu identique en clair comme en sombre.
 */
export default function AlteniaLogo({ size = 88 }: { size?: number }) {
  return (
    <Box
      aria-hidden
      sx={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: '50%',
        bgcolor: '#ffffff',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow:
          '0 0 0 1.5px rgba(212,175,55,.5), 0 18px 44px rgba(0,0,0,.16)',
      }}
    >
      <Typography
        sx={{
          color: '#101828',
          fontFamily: "Georgia, 'Times New Roman', serif",
          fontWeight: 800,
          fontSize: size * 0.21,
          lineHeight: 1,
          letterSpacing: '-0.5px',
        }}
      >
        Altenia
      </Typography>
      <Box
        sx={{
          height: 2,
          width: '58%',
          my: 0.5,
          borderRadius: 1,
          background:
            'linear-gradient(90deg, #101828, #d4af37, #101828)',
        }}
      />
      <Typography
        sx={{
          color: '#101828',
          fontWeight: 600,
          fontSize: size * 0.085,
          letterSpacing: '0.4px',
        }}
      >
        Technologie
      </Typography>
    </Box>
  );
}
