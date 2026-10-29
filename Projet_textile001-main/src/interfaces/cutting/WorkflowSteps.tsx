'use client';

import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

/**
 * Fil d'Ariane du workflow du chef de coupe (10 étapes explicites).
 * Chaque étape reflète l'état RÉEL du plan : une coupe n'est jamais
 * considérée comme effectuée tant que le transfert confirmé n'existe
 * pas (étape 10), même si le plan est sauvegardé ou validé.
 */

interface WorkflowStepsProps {
  rollSelected: boolean;
  productSelected: boolean;
  revisionValide: boolean;
  planCreated: boolean;
  hasPlacements: boolean;
  noViolations: boolean;
  saved: boolean;
  planValide: boolean;
  transferred: boolean;
  dirty: boolean;
}

const STEP_LABELS = [
  'Rouleau', 'Produit', 'Taille / qté', 'Fiche + révision', 'Pièces',
  'Placement', 'Conflits', 'Sauvegarde', 'Récapitulatif', 'Coupe confirmée',
] as const;

export default function WorkflowSteps(props: WorkflowStepsProps) {
  const {
    rollSelected, productSelected, revisionValide, planCreated,
    hasPlacements, noViolations, saved, planValide, transferred, dirty,
  } = props;
  const done = [
    rollSelected, productSelected, productSelected, revisionValide,
    planCreated && hasPlacements, hasPlacements,
    planCreated && noViolations,
    saved && !dirty, planValide, transferred,
  ];
  const current = done.findIndex((value) => !value);
  return (
    <Stack
      direction="row" spacing={0.5} sx={{
        px: 1, py: 0.5, alignItems: 'center', flexWrap: 'wrap',
        borderBottom: '1px solid', borderColor: 'divider',
        bgcolor: 'background.paper',
      }}
    >
      <Typography variant="caption" sx={{ fontWeight: 600, mr: 0.5 }}>
        Étapes :
      </Typography>
      {STEP_LABELS.map((label, index) => {
        const isDone = done[index];
        const isCurrent = index === current;
        const chip = (
          <Chip
            size="small"
            label={`${index + 1}. ${label}`}
            color={isDone ? 'success' : isCurrent ? 'warning' : 'default'}
            variant={isCurrent ? 'filled' : 'outlined'}
            sx={{ height: 22, '& .MuiChip-label': { fontSize: 11, px: 0.8 } }}
          />
        );
        return isCurrent ? (
          <Tooltip key={label} title="Étape en cours">
            <span>{chip}</span>
          </Tooltip>
        ) : (
          <Box key={label}>{chip}</Box>
        );
      })}
    </Stack>
  );
}
