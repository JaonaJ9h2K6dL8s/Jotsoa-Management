'use client';

import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import PrintIcon from '@mui/icons-material/Print';
import type { MarkerPlanRow } from '@/server/coupe/marker';

/**
 * Affichage du plan de placement (marker) : contours des pièces,
 * tailles, repères et indicateurs de consommation. Le tracé est
 * proportionnel aux dimensions réelles du matelas. L'impression est
 * locale (fenêtre d'impression du poste), sans dépendance réseau.
 */

const PALETTE = [
  '#7986cb', '#64b5f6', '#4db6ac', '#aed581', '#ffb74d',
  '#f06292', '#9575cd', '#4fc3f7', '#81c784', '#ffd54f',
];

function sizeColor(sizeId: number): string {
  return PALETTE[Math.abs(sizeId) % PALETTE.length];
}

export default function LotPlanPanel({ plan }: { plan: MarkerPlanRow }) {
  const widthCm = plan.usableWidthCm;
  const lengthCm = plan.matelasLengthCm;
  const scale = Math.min(900 / Math.max(lengthCm, 1), 380 / Math.max(widthCm, 1));
  const svgWidth = lengthCm * scale;
  const svgHeight = widthCm * scale;
  const placements = plan.result?.placements ?? [];

  function printPlan() {
    const svg = document.getElementById('lot-plan-svg');
    if (!svg) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    printWindow.document.write(
      `<!doctype html><html><head><title>Plan de placement ${plan.productName}</title>` +
        `<style>body{font-family:sans-serif;margin:16px}svg{max-width:100%;height:auto}</style></head><body>` +
        `<h3>Plan de placement — ${plan.productName}</h3>` +
        `<p>Matelas ${plan.matelasLengthCm} cm × ${plan.usableWidthCm} cm — ${plan.layers} couche(s) — ` +
        `utilisation ${plan.efficiency.toFixed(1)} %</p>` +
        svg.outerHTML +
        `<script>window.print()</script></body></html>`,
    );
    printWindow.document.close();
  }

  return (
    <Stack spacing={1}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="subtitle2">
          Plan de placement — table {plan.coupeTableNom ?? 'non définie'},
          matelas {plan.matelasLengthCm} cm × {plan.usableWidthCm} cm,
          {' '}{plan.layers} couche(s)
        </Typography>
        <Button
          size="small"
          startIcon={<PrintIcon />}
          onClick={printPlan}
        >
          Imprimer le plan
        </Button>
      </Stack>
      <Paper variant="outlined" sx={{ p: 1, overflowX: 'auto' }}>
        <svg
          id="lot-plan-svg"
          width={svgWidth}
          height={svgHeight}
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          role="img"
          aria-label="Plan de placement des pièces"
        >
          <rect
            x={0}
            y={0}
            width={svgWidth}
            height={svgHeight}
            fill="#f5f5f5"
            stroke="#9e9e9e"
          />
          {placements.map((placement, index) => (
            <polygon
              key={`${placement.patternId}-${index}`}
              points={placement.points
                .map((point) => `${point.x * scale},${point.y * scale}`)
                .join(' ')}
              fill={sizeColor(placement.sizeId)}
              fillOpacity={0.55}
              stroke="#37474f"
              strokeWidth={0.6}
            >
              <title>
                {`${placement.pieceLabel} — taille ${placement.sizeNom} — rotation ${placement.rotation}°`}
              </title>
            </polygon>
          ))}
          {placements.map((placement, index) => (
            <text
              key={`label-${placement.patternId}-${index}`}
              x={(placement.x + 2) * scale}
              y={(placement.y + 8) * scale}
              fontSize={Math.max(7, 9 * (scale / 2))}
              fill="#263238"
            >
              {placement.pieceCode} · {placement.sizeNom}
            </text>
          ))}
        </svg>
      </Paper>
      <Stack direction="row" spacing={3} flexWrap="wrap">
        <Typography variant="caption">
          Pièces par couche : {plan.totalPieces} (total {plan.totalPieces * plan.layers})
        </Typography>
        <Typography variant="caption">
          Longueur du marker : {plan.markerLengthCm} cm
        </Typography>
        <Typography variant="caption">
          Consommation théorique :{' '}
          {((plan.matelasLengthCm * plan.layers) / 100).toFixed(2)} m
        </Typography>
        <Typography variant="caption">
          Taux d&apos;utilisation : {plan.efficiency.toFixed(1)} %
        </Typography>
        <Typography variant="caption">
          Surface non utilisée : {plan.wasteAreaM2.toFixed(2)} m²
          {plan.wasteKgEst != null ? ` (~${plan.wasteKgEst.toFixed(2)} kg)` : ''}
        </Typography>
        <Typography variant="caption">
          Statut : {plan.status === 'valide' ? 'Validé' : 'Proposition'}
        </Typography>
      </Stack>
    </Stack>
  );
}
