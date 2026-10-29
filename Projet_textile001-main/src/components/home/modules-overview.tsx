import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import { MODULES } from '@/lib/modules';

/**
 * Grille des modules prévus (composant serveur), présentée dans le
 * panneau droit de la page d'accueil. Aucune action fictive.
 */
export default function ModulesOverview() {
  return (
    <section aria-label="Modules prévus">
      <Box sx={{ textAlign: 'center', mb: 4 }}>
        <Typography variant="h4" component="h2" sx={{ fontWeight: 800 }}>
          Modules prévus
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Un parcours complet, du tissu brut au produit fini expédié.
        </Typography>
        <Chip
          label={`${MODULES.length} modules`}
          size="small"
          variant="outlined"
          sx={{
            mt: 1.5,
            borderRadius: '999px',
            fontWeight: 700,
            fontSize: 12,
            color: 'text.secondary',
            borderColor: 'divider',
            bgcolor: 'action.hover',
          }}
        />
      </Box>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {MODULES.map((module) => {
          const Icon = module.icon;
          return (
            <Card
              key={module.key}
              variant="outlined"
              sx={{
                borderRadius: '16px',
                transition:
                  'transform .3s ease, box-shadow .3s ease, border-color .3s ease',
                '&:hover': {
                  transform: 'translateY(-4px)',
                  boxShadow: '0 16px 36px rgba(0,0,0,.10)',
                  borderColor: 'primary.main',
                },
              }}
            >
              <CardContent className="flex items-start gap-3">
                <Box
                  aria-hidden
                  sx={{
                    width: 44,
                    height: 44,
                    flexShrink: 0,
                    borderRadius: '12px',
                    display: 'grid',
                    placeItems: 'center',
                    color: 'primary.main',
                    bgcolor: 'rgba(31,174,116,0.12)',
                  }}
                >
                  <Icon fontSize="small" />
                </Box>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <Typography
                      variant="subtitle1"
                      component="h3"
                      sx={{ fontWeight: 700 }}
                    >
                      {module.label}
                    </Typography>
                    <Chip
                      label="Planifié"
                      size="small"
                      variant="outlined"
                      sx={{
                        borderRadius: '999px',
                        fontSize: 11,
                        fontWeight: 700,
                        letterSpacing: '0.4px',
                        color: 'text.secondary',
                        borderColor: 'divider',
                        bgcolor: 'action.hover',
                      }}
                    />
                  </div>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ mt: 0.5 }}
                  >
                    {module.description}
                  </Typography>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
