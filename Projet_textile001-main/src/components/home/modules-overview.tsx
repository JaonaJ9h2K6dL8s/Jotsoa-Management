import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import { MODULES } from '@/lib/modules';

/**
 * Vue d'ensemble des modules prévus (composant serveur).
 * Aucune action fictive : les modules sont présentés comme planifiés.
 */
export default function ModulesOverview() {
  return (
    <section aria-label="Modules prévus">
      <Typography variant="h6" component="h2" gutterBottom>
        Modules prévus
      </Typography>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {MODULES.map((module) => {
          const Icon = module.icon;
          return (
            <Card key={module.key} variant="outlined">
              <CardContent className="flex items-start gap-3">
                <Icon color="primary" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <Typography variant="subtitle1" component="h3">
                      {module.label}
                    </Typography>
                    <Chip label="Planifié" size="small" variant="outlined" />
                  </div>
                  <Typography variant="body2" color="text.secondary">
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
