'use client';

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import type { Kpi } from '@/types/pilotage';

/**
 * Cartes d'indicateurs : valeur, unité, définition de la source et
 * comparaison avec la période précédente. Aucun calcul local : les
 * comparaisons sont calculées côté serveur.
 */

function formatSigned(value: number): string {
  return `${value >= 0 ? '+' : ''}${value}`;
}

function comparisonLine(kpi: Kpi): string | null {
  if (kpi.previous === null) return null;
  const previous = `précédent : ${kpi.previous}`;
  if (kpi.deltaPercent === null) {
    return `${previous} ${kpi.unit} — variation absolue ${formatSigned(kpi.delta ?? 0)} (pourcentage non calculable : période précédente à zéro)`;
  }
  return `${previous} — variation ${formatSigned(kpi.delta ?? 0)} (${kpi.deltaPercent >= 0 ? '+' : ''}${kpi.deltaPercent.toFixed(1)} %)`;
}

function KpiCard({ kpi }: { kpi: Kpi }) {
  const comparison = comparisonLine(kpi);
  return (
    <Grid size={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
      <Paper variant="outlined" className="h-full p-3">
        <Stack direction="row" spacing={1} alignItems="flex-start" justifyContent="space-between">
          <Typography variant="h5" component="p">
            {kpi.value.toLocaleString('fr-FR')}{' '}
            <Typography variant="caption" component="span" color="text.secondary">
              {kpi.unit}
            </Typography>
          </Typography>
          {kpi.previous === null ? (
            <Tooltip title="Indicateur d'instant : sans comparaison de période.">
              <Chip label="instant" size="small" variant="outlined" />
            </Tooltip>
          ) : kpi.deltaPercent !== null ? (
            <Chip
              size="small"
              variant="outlined"
              color={kpi.deltaPercent >= 0 ? 'success' : 'warning'}
              label={`${kpi.deltaPercent >= 0 ? '+' : ''}${kpi.deltaPercent.toFixed(1)} %`}
            />
          ) : (
            <Chip
              size="small"
              variant="outlined"
              label={`Δ ${formatSigned(kpi.delta ?? 0)}`}
              color={kpi.delta !== null && kpi.delta < 0 ? 'warning' : 'default'}
            />
          )}
        </Stack>
        <Typography variant="body2" fontWeight={600}>
          {kpi.label}
        </Typography>
        <Tooltip title={kpi.definition} placement="top">
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {kpi.definition}
          </Typography>
        </Tooltip>
        {comparison ? (
          <Typography variant="caption" display="block" color="text.secondary" sx={{ mt: 0.5 }}>
            {comparison}
          </Typography>
        ) : null}
      </Paper>
    </Grid>
  );
}

export default function KpiCards({ kpis }: { kpis: Kpi[] }) {
  if (kpis.length === 0) {
    return (
      <Box>
        <Typography color="text.secondary">Aucun indicateur disponible.</Typography>
      </Box>
    );
  }
  return (
    <Grid container spacing={2}>
      {kpis.map((kpi) => (
        <KpiCard key={kpi.key} kpi={kpi} />
      ))}
    </Grid>
  );
}
