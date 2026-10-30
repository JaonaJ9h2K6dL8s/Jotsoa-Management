'use client';

import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import type { OptimizeMetrics, OptimizeResult } from './api';
import { wastePctOf } from '@/lib/cutting/metrics';

/**
 * Comparaison « plan actuel ↔ proposition optimisée » — interface
 * épurée : 3 indicateurs clés en cartes, tableau détaillé compact,
 * et tous les détails techniques (phases, candidats, stratégies)
 * repliés dans « Détails du calcul ».
 *
 * Formules (documentées, unités réelles) :
 * - Longueur consommée (cm) : étendue maximale des pièces le long du
 *   matelas — bande de tissu réellement déroulée.
 * - Surface consommée (m²) = largeur utilisable × longueur consommée.
 * - Chutes (m²) = surface consommée − surface des pièces.
 * - Taux d'utilisation (%) = surface pièces / surface consommée × 100.
 * - Pertes (kg) = chutes × grammage / 1000 (si grammage connu).
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

function fmt(value: number | null, unit: string, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${value.toFixed(digits)} ${unit}`;
}

/** Carte indicateur clé : valeur proposition + évolution vs plan actuel. */
function StatCard({
  label, value, delta, better, hint,
}: {
  label: string;
  value: string;
  delta: string | null;
  better: boolean | null;
  hint?: string;
}) {
  return (
    <Box sx={{
      flex: 1, minWidth: 120, p: 1, borderRadius: 1.5, bgcolor: '#f6faf8',
      border: '1px solid', borderColor: 'divider', textAlign: 'center',
    }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
        {label}
      </Typography>
      <Tooltip title={hint ?? ''}>
        <Typography sx={{ fontSize: 20, fontWeight: 800, lineHeight: 1.2, color: 'primary.main' }}>
          {value}
        </Typography>
      </Tooltip>
      {delta !== null && (
        <Typography variant="caption" sx={{
          fontWeight: 700, display: 'block',
          color: better ? 'success.main' : delta === '≈' ? 'text.secondary' : 'error.main',
        }}>
          {delta}
        </Typography>
      )}
    </Box>
  );
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
    <Stack direction="row" sx={{ py: 0.25, alignItems: 'baseline' }}>
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

export default function PanelOptimize(props: PanelOptimizeProps) {
  const { proposal, currentMetrics, currentWasteKg, sameCoverage, accepting, onAccept, onReject } = props;
  const [detailsOpen, setDetailsOpen] = useState(false);
  const m = proposal.metrics;

  const gainLength = currentMetrics && sameCoverage
    ? currentMetrics.consumedLengthCm - m.consumedLengthCm : null;
  const gainPercent = gainLength !== null && (currentMetrics?.consumedLengthCm ?? 0) > 0
    ? gainLength / (currentMetrics?.consumedLengthCm ?? 1) * 100 : null;
  const gainUtil = currentMetrics && sameCoverage
    ? m.utilizationPct - currentMetrics.utilizationPct : null;
  const gainWaste = currentMetrics && sameCoverage
    ? wastePctOf(currentMetrics) - wastePctOf(m) : null;
  const isBetter = gainLength !== null && gainLength > 0.05;

  return (
    <Box sx={{
      mx: 1, mt: 1, p: 1.25, borderRadius: 2,
      border: '1px solid', borderColor: isBetter ? 'success.main' : 'divider',
      bgcolor: 'background.paper',
      boxShadow: isBetter ? '0 2px 12px rgba(15,122,77,0.10)' : 'none',
    }}>
      {/* En-tête : verdict + actions */}
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
        {sameCoverage === false ? (
          <WarningAmberIcon sx={{ fontSize: 20, color: 'warning.main' }} />
        ) : (
          <CheckCircleIcon sx={{
            fontSize: 20, color: isBetter ? 'success.main' : 'text.secondary',
          }} />
        )}
        <Typography variant="subtitle2" sx={{ fontWeight: 700, flex: 1 }}>
          {sameCoverage
            ? (isBetter
              ? `Proposition optimisée : −${gainLength?.toFixed(0)} cm de tissu`
              : 'Proposition de longueur équivalente')
            : 'Proposition à comparer (couverture différente)'}
        </Typography>
        <Button size="small" variant="contained" disabled={accepting} onClick={onAccept}>
          Accepter
        </Button>
        <Button size="small" color="error" disabled={accepting} onClick={onReject}>
          Rejeter
        </Button>
      </Stack>

      {/* Production calculée automatiquement */}
      {proposal.setsCount !== undefined && proposal.piecesPerSet !== undefined && (
        <Box sx={{
          px: 1, py: 0.5, mb: 1, borderRadius: 1.5, bgcolor: '#eef7f3',
          border: '1px dashed', borderColor: 'success.main',
          display: 'flex', alignItems: 'baseline', gap: 0.75, flexWrap: 'wrap',
        }}>
          <Typography variant="caption" sx={{ fontWeight: 700 }}>
            Production calculée :
          </Typography>
          <Typography variant="caption">
            {proposal.setsCount} jeux complets × {proposal.layers ?? 1} couche(s)
            = <strong>{proposal.garmentsTotal ?? (proposal.setsCount * (proposal.layers ?? 1))} vêtements</strong>
            {' '}({proposal.piecesTotal ?? '—'} pièces coupées, patron à {proposal.piecesPerSet} pièces)
          </Typography>
        </Box>
      )}

      {/* 3 indicateurs clés */}
      <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: 'wrap', rowGap: 1 }}>
        <StatCard
          label="Utilisation"
          value={fmt(m.utilizationPct, '%')}
          delta={gainUtil === null ? null
            : `${gainUtil >= 0 ? '+' : ''}${gainUtil.toFixed(1)} pts vs plan actuel`}
          better={gainUtil !== null && gainUtil > 0.05}
          hint="Taux géométrique : surface pièces / surface consommée (≠ rendement industriel)."
        />
        <StatCard
          label="Tissu consommé"
          value={fmt(m.consumedLengthCm, 'cm', 0)}
          delta={gainLength === null ? null
            : Math.abs(gainLength) <= 0.05 ? '≈ identique'
              : `${gainLength > 0 ? '−' : '+'}${Math.abs(gainLength).toFixed(0)} cm`
                + ` (${gainPercent === null ? '—' : `${gainPercent.toFixed(1)} %`})`}
          better={gainLength !== null && gainLength > 0.05}
          hint="Bande de tissu réellement déroulée le long du matelas."
        />
        <StatCard
          label="Chutes"
          value={fmt(wastePctOf(m), '%')}
          delta={gainWaste === null ? null
            : `${gainWaste >= 0 ? '−' : '+'}${Math.abs(gainWaste).toFixed(1)} pts vs plan actuel`}
          better={gainWaste !== null && gainWaste > 0.05}
          hint={`Pertes poids : ${proposal.wasteKg === null
            ? 'indisponibles (grammage inconnu)'
            : `${proposal.wasteKg.toFixed(2)} kg`}`}
        />
      </Stack>

      {/* Tableau détaillé compact */}
      <Stack direction="row" sx={{ mb: 0.25 }}>
        <Typography variant="caption" sx={{ flex: 1.4 }} />
        <Typography variant="caption" sx={{ flex: 1, textAlign: 'right' }} color="text.secondary">Plan actuel</Typography>
        <Typography variant="caption" sx={{ flex: 1, textAlign: 'right' }} color="text.secondary">Proposition</Typography>
      </Stack>
      <MetricRow
        label="Surface consommée"
        current={fmt(currentMetrics?.consumedAreaM2 ?? null, 'm²', 2)}
        proposal={fmt(m.consumedAreaM2, 'm²', 2)}
      />
      <MetricRow
        label="Surface des pièces (aires exactes)"
        current={fmt(currentMetrics?.piecesAreaM2 ?? null, 'm²', 2)}
        proposal={fmt(m.piecesAreaM2, 'm²', 2)}
      />
      <MetricRow
        label="Chutes estimées"
        current={fmt(currentMetrics?.wasteAreaM2 ?? null, 'm²', 2)}
        proposal={fmt(m.wasteAreaM2, 'm²', 2)}
      />
      <MetricRow
        label="Pertes en poids (chutes × grammage)"
        current={currentWasteKg === null ? 'indisponible' : fmt(currentWasteKg, 'kg', 2)}
        proposal={proposal.wasteKg === null ? 'indisponible' : fmt(proposal.wasteKg, 'kg', 2)}
      />
      <MetricRow
        label="Pièces placées / non placées"
        current={`${currentMetrics?.placedCount ?? 0} / ${currentMetrics?.unplacedCount ?? 0}`}
        proposal={`${m.placedCount} / ${m.unplacedCount}`}
      />

      <Divider sx={{ my: 0.75 }} />
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

      {/* Détails techniques repliés */}
      <Box
        component="button"
        onClick={() => setDetailsOpen((value) => !value)}
        sx={{
          display: 'inline-flex', alignItems: 'center', gap: 0.25, mt: 0.5,
          cursor: 'pointer', border: 'none', bgcolor: 'transparent', p: 0,
          color: 'text.secondary', fontSize: 11,
          '&:hover': { color: 'primary.main' },
        }}
      >
        {detailsOpen ? <ExpandLessIcon sx={{ fontSize: 14 }} /> : <ExpandMoreIcon sx={{ fontSize: 14 }} />}
        Détails du calcul
      </Box>
      <Collapse in={detailsOpen}>
        <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, flexWrap: 'wrap', rowGap: 0.5 }}>
          {proposal.computeMs !== undefined && (
            <Chip size="small" variant="outlined" label={`calcul ${proposal.computeMs} ms`} />
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
          <Chip size="small" variant="outlined" label="jeux complets — matelas rempli" />
        </Stack>
        {proposal.candidates && proposal.candidates.length > 1 && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
            Stratégies comparées (même jeu de pièces, mêmes contraintes) :
            {' '}{proposal.candidates.map((candidate) => `${candidate.strategy} `
              + `(${candidate.unplaced} non placée(s), ${candidate.consumedLengthCm.toFixed(0)} cm`
              + `${candidate.retained ? ' — retenue' : ''})`).join(' · ')}
          </Typography>
        )}
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
          Accepter applique la proposition au canvas puis relance la vérification serveur
          (plan.verify). L’enregistrement reste une action explicite distincte.
          Le placement manuel reste possible à tout moment.
          {proposal.method === 'nest-blf'
            ? ' Méthode heuristique (bottom-left sur contours réels) : aucune garantie d’optimum global ; la référence shelf-ffd est conservée si elle est meilleure.'
            : ' Méthode de référence par étagères (enveloppes).'}
        </Typography>
      </Collapse>
    </Box>
  );
}
