'use client';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { OptimizeMetrics, OptimizeResult } from './api';
import { wastePctOf } from '@/lib/cutting/metrics';

/**
 * Comparaison « plan actuel ↔ proposition optimisée » et indicateurs.
 *
 * Formules (documentées, unités réelles) :
 * - Longueur consommée (cm) : étendue maximale des pièces le long du
 *   matelas — c'est la bande de tissu réellement déroulée.
 * - Surface consommée (m²) = largeur utilisable × longueur consommée.
 * - Surface des pièces (m²) = somme des aires exactes des contours.
 * - Chutes (m²) = surface consommée − surface des pièces (espaces
 *   entre pièces inclus ; les contours sont exacts).
 * - Taux d'utilisation (%) = surface pièces / surface consommée × 100.
 *   C'est un taux GÉOMÉTRIQUE : le rendement industriel réel est
 *   inférieur (chutes de début/fin, défauts tissu, raccords).
 * - Pertes (kg) = chutes (m²) × grammage (g/m²) / 1000 — affiché
 *   seulement si le grammage du rouleau est connu, sinon
 *   « Estimation en kg indisponible ».
 */

interface PanelOptimizeProps {
  proposal: OptimizeResult;
  currentMetrics: OptimizeMetrics | null;
  currentWasteKg: number | null;
  sameCoverage: boolean;
  accepting: boolean;
  onAccept: () => void;
  onReject: () => void;
}

function MetricRow({
  label, current, proposal, hint,
}: {
  label: string;
  current: string;
  proposal: string;
  hint?: string;
}) {
  return (
    <Stack direction="row" sx={{ py: 0.3, alignItems: 'baseline' }}>
      <Typography variant="caption" sx={{ flex: 1.4 }} color="text.secondary">
        {label}
        {hint ? ` — ${hint}` : ''}
      </Typography>
      <Typography variant="body2" sx={{ flex: 1, textAlign: 'right' }}>{current}</Typography>
      <Typography variant="body2" sx={{ flex: 1, textAlign: 'right', fontWeight: 600 }}>
        {proposal}
      </Typography>
    </Stack>
  );
}

function fmt(value: number | null, unit: string, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${value.toFixed(digits)} ${unit}`;
}

const METHOD_LABELS: Record<string, string> = {
  'shelf-ffd': 'étagères FFD — référence (enveloppes)',
  'nest-blf': 'nesting BLF — contours réels',
};

export default function PanelOptimize(props: PanelOptimizeProps) {
  const { proposal, currentMetrics, currentWasteKg, sameCoverage, accepting, onAccept, onReject } = props;
  const m = proposal.metrics;
  const gainLength = currentMetrics && sameCoverage
    ? currentMetrics.consumedLengthCm - m.consumedLengthCm : null;
  const gainPercent = gainLength !== null && (currentMetrics?.consumedLengthCm ?? 0) > 0
    ? gainLength / (currentMetrics?.consumedLengthCm ?? 1) * 100 : null;
  const title = !sameCoverage
    ? 'Proposition à comparer (couverture différente)'
    : gainLength !== null && gainLength < -0.05
      ? 'Proposition plus longue que le plan actuel'
      : gainLength !== null && Math.abs(gainLength) <= 0.05
        ? 'Proposition de longueur équivalente'
        : 'Proposition optimisée';

  return (
    <Box sx={{
      mx: 1, mt: 1, p: 1.5, borderRadius: 2, border: '1px solid',
      borderColor: 'primary.main', bgcolor: 'background.paper',
    }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
        <Typography variant="subtitle2">
          {title} ({METHOD_LABELS[proposal.method] ?? proposal.method})
        </Typography>
        {proposal.computeMs !== undefined && (
          <Chip size="small" variant="outlined"
            label={`calcul ${proposal.computeMs} ms`} />
        )}
        {proposal.improve !== undefined && proposal.improve.movesAccepted > 0 && (
          <Chip size="small" variant="outlined"
            label={`${proposal.improveApplied ? 'amélioration locale retenue' : 'amélioration locale testée, non retenue'} : ${proposal.improve.movesAccepted} mouvement(s)`} />
        )}
        {proposal.phaseMs && (
          <Chip size="small" variant="outlined"
            label={`phases S ${proposal.phaseMs.shelfFfd} · BLF ${proposal.phaseMs.nestBlf} · local ${proposal.phaseMs.localImprove} ms`} />
        )}
        {proposal.budgetExpired && (
          <Chip size="small" color="warning" label="budget atteint — meilleure solution valide conservée" />
        )}
        {proposal.fallbackUsed && (
          <Chip size="small" color="warning" variant="outlined" label="repli shelf-ffd utilisé" />
        )}
        {proposal.stats !== undefined && (
          <Chip size="small" variant="outlined"
            label={proposal.stats.expired
              ? `BLF interrompu (${proposal.stats.exactTests} tests géométriques)`
              : `${proposal.stats.candidatesTested} candidats · ${proposal.stats.exactTests} tests`} />
        )}
        <Chip size="small" variant="outlined"
          label="meilleure solution valide conservée (référence shelf-ffd incluse)" />
        <Chip
          size="small"
          color={gainLength !== null && gainLength > 0.05 ? 'success' : 'default'}
          label={gainLength !== null
            ? (Math.abs(gainLength) <= 0.05
              ? 'longueur équivalente'
              : `${gainLength > 0 ? '−' : '+'}${Math.abs(gainLength).toFixed(0)} cm `
                + `(${gainPercent === null ? '—' : `${gainPercent.toFixed(1)} %`}) de longueur`)
            : (currentMetrics ? 'couverture différente : gain non comparable' : 'plan actuel vide')}
        />
        <Box sx={{ flex: 1 }} />
        <Button size="small" variant="contained" disabled={accepting} onClick={onAccept}>
          Accepter
        </Button>
        <Button size="small" color="error" disabled={accepting} onClick={onReject}>
          Rejeter
        </Button>
      </Stack>
      {proposal.candidates && proposal.candidates.length > 1 && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
          Stratégies comparées (même jeu de pièces, mêmes contraintes) :
          {' '}{proposal.candidates.map((candidate) => `${candidate.strategy} `
            + `(${candidate.unplaced} non placée(s), ${candidate.consumedLengthCm.toFixed(0)} cm`
            + `${candidate.retained ? ' — retenue' : ''})`).join(' · ')}
        </Typography>
      )}
      <Stack direction="row" sx={{ mb: 0.5 }}>
        <Typography variant="caption" sx={{ flex: 1.4 }} />
        <Typography variant="caption" sx={{ flex: 1, textAlign: 'right' }} color="text.secondary">Plan actuel</Typography>
        <Typography variant="caption" sx={{ flex: 1, textAlign: 'right' }} color="text.secondary">Proposition</Typography>
      </Stack>
      <MetricRow
        label="Longueur de tissu consommée"
        current={fmt(currentMetrics?.consumedLengthCm ?? null, 'cm', 0)}
        proposal={fmt(m.consumedLengthCm, 'cm', 0)}
      />
      <MetricRow
        label="Surface consommée (largeur utile × longueur)"
        current={fmt(currentMetrics?.consumedAreaM2 ?? null, 'm²', 2)}
        proposal={fmt(m.consumedAreaM2, 'm²', 2)}
      />
      <MetricRow
        label="Surface des pièces (aires exactes)"
        current={fmt(currentMetrics?.piecesAreaM2 ?? null, 'm²', 2)}
        proposal={fmt(m.piecesAreaM2, 'm²', 2)}
      />
      <MetricRow
        label="Chutes estimées (consommée − pièces)"
        current={fmt(currentMetrics?.wasteAreaM2 ?? null, 'm²', 2)}
        proposal={fmt(m.wasteAreaM2, 'm²', 2)}
      />
      <MetricRow
        label="Taux d'utilisation géométrique (≠ rendement industriel)"
        current={fmt(currentMetrics?.utilizationPct ?? null, '%')}
        proposal={fmt(m.utilizationPct, '%')}
        hint={sameCoverage ? undefined : 'couverture différente : valeurs non comparables'}
      />
      <MetricRow
        label="Taux de perte géométrique estimée"
        current={fmt(currentMetrics ? wastePctOf(currentMetrics) : null, '%')}
        proposal={fmt(wastePctOf(m), '%')}
      />
      <MetricRow
        label="Pertes en poids (chutes × grammage)"
        current={currentWasteKg === null ? 'Estimation en kg indisponible'
          : fmt(currentWasteKg, 'kg', 2)}
        proposal={proposal.wasteKg === null ? 'Estimation en kg indisponible'
          : fmt(proposal.wasteKg, 'kg', 2)}
      />
      <MetricRow
        label="Pièces placées / non placées"
        current={`${currentMetrics?.placedCount ?? 0} / ${currentMetrics?.unplacedCount ?? 0}`}
        proposal={`${m.placedCount} / ${m.unplacedCount}`}
      />
      <Divider sx={{ my: 1 }} />
      {proposal.unplaced.length === 0 ? (
        <Typography variant="caption" color="success.main">
          Toutes les pièces requises sont placées dans la proposition.
        </Typography>
      ) : (
        <Stack spacing={0.5}>
          <Typography variant="caption" sx={{ fontWeight: 600 }}>
            Pièces non placées ({proposal.unplaced.length}) :
          </Typography>
          {proposal.unplaced.map((item) => (
            <Typography key={`${item.code}-${item.reason}`} variant="caption" color="error.main">
              • {item.label} ×{item.quantity} : {item.reason}
            </Typography>
          ))}
        </Stack>
      )}
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
        Accepter applique la proposition au canvas puis relance la vérification serveur
        (plan.verify). L’enregistrement reste une action explicite distincte.
        Le placement manuel reste possible à tout moment.
        {proposal.method === 'nest-blf'
          ? ' Méthode heuristique (bottom-left sur contours réels, ordres déterministes, budget de calcul borné) : aucune garantie d’optimum global ; la référence shelf-ffd est conservée si elle est meilleure.'
          : ' Méthode de référence par étagères (enveloppes) : simple et robuste, sans imbrication des espaces libres.'}
      </Typography>
    </Box>
  );
}
