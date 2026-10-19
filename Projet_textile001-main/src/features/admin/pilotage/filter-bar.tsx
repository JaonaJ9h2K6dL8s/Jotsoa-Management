'use client';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Grid from '@mui/material/Grid';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import TextField from '@mui/material/TextField';
import { EMPTY_FILTERS, type PeriodPreset, type PilotageFilterState } from '@/types/pilotage';

/**
 * Barre de filtres des rapports : période et filtres de dimension.
 * Les valeurs sont transmises au serveur qui les valide et les
 * applique en SQL ; les champs vides sont simplement omis.
 */

const PERIOD_LABELS: Array<[PeriodPreset, string]> = [
  ['jour', "Aujourd'hui"],
  ['semaine', 'Semaine en cours'],
  ['mois', 'Mois en cours'],
  ['trimestre', 'Trimestre en cours'],
  ['annee', 'Année en cours'],
  ['personnalisee', 'Période personnalisée'],
];

const NUMBER_FIELDS: Array<[keyof PilotageFilterState, string]> = [
  ['lotId', 'Lot (n°)'],
  ['productId', 'Produit (n°)'],
  ['colorId', 'Couleur (n°)'],
  ['sizeId', 'Taille (n°)'],
  ['roomId', 'Salle (n°)'],
  ['lineId', 'Ligne (n°)'],
  ['userId', 'Responsable (n°)'],
  ['cartonId', 'Carton (n°)'],
  ['locationId', 'Emplacement (n°)'],
];

interface FilterBarProps {
  period: PeriodPreset;
  onPeriodChange: (value: PeriodPreset) => void;
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  filters: PilotageFilterState;
  onFilterChange: (key: keyof PilotageFilterState, value: string) => void;
  onReset: () => void;
  advanced: boolean;
  onToggleAdvanced: () => void;
}

export default function FilterBar({
  period,
  onPeriodChange,
  from,
  to,
  onFromChange,
  onToChange,
  filters,
  onFilterChange,
  onReset,
  advanced,
  onToggleAdvanced,
}: FilterBarProps) {
  return (
    <Box>
      <Grid container spacing={2} alignItems="center">
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <InputLabel id="period-label" size="small">
            Période
          </InputLabel>
          <Select
            labelId="period-label"
            value={period}
            onChange={(event) => onPeriodChange(event.target.value as PeriodPreset)}
            size="small"
            fullWidth
          >
            {PERIOD_LABELS.map(([value, label]) => (
              <MenuItem key={value} value={value}>
                {label}
              </MenuItem>
            ))}
          </Select>
        </Grid>
        {period === 'personnalisee' ? (
          <>
            <Grid size={{ xs: 6, sm: 3, md: 2 }}>
              <TextField
                label="Du"
                type="date"
                size="small"
                value={from}
                onChange={(event) => onFromChange(event.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
                fullWidth
              />
            </Grid>
            <Grid size={{ xs: 6, sm: 3, md: 2 }}>
              <TextField
                label="Au"
                type="date"
                size="small"
                value={to}
                onChange={(event) => onToChange(event.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
                fullWidth
              />
            </Grid>
          </>
        ) : null}
        <Grid size={{ xs: 12, md: 3 }} sx={{ display: 'flex', gap: 1 }}>
          <Button size="small" onClick={onToggleAdvanced}>
            {advanced ? 'Masquer les filtres' : 'Filtres avancés'}
          </Button>
          <Button size="small" onClick={onReset}>
            Réinitialiser
          </Button>
        </Grid>
      </Grid>
      {advanced ? (
        <Grid container spacing={2} sx={{ mt: 1 }}>
          {NUMBER_FIELDS.map(([key, label]) => (
            <Grid key={key} size={{ xs: 6, sm: 3, md: 2 }}>
              <TextField
                label={label}
                size="small"
                value={filters[key]}
                onChange={(event) => onFilterChange(key, event.target.value)}
                fullWidth
              />
            </Grid>
          ))}
          <Grid size={{ xs: 6, sm: 3, md: 2 }}>
            <TextField
              label="Statut"
              size="small"
              value={filters.status}
              onChange={(event) =>
                onFilterChange('status', event.target.value.toLowerCase().replace(/[^a-z_]/g, ''))
              }
              fullWidth
            />
          </Grid>
          <Grid size={{ xs: 6, sm: 3, md: 2 }}>
            <TextField
              label="Réf. commande"
              size="small"
              value={filters.orderRef}
              onChange={(event) => onFilterChange('orderRef', event.target.value)}
              fullWidth
            />
          </Grid>
        </Grid>
      ) : null}
    </Box>
  );
}

export { EMPTY_FILTERS };
