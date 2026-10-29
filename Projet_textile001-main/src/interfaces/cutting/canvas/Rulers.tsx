/**
 * Règles horizontale et verticale du canvas (graduations en cm le
 * long de la table). Le pas s'adapte au zoom pour rester lisible :
 * 10/25/50/100/200 cm — les règles restent dans le repère monde, donc
 * pan et zoom les déplacent naturellement avec la table.
 */

const STEPS = [10, 25, 50, 100, 200] as const;

export function rulerStep(lengthCm: number): number {
  for (const step of STEPS) {
    if (lengthCm / step <= 25) return step;
  }
  return STEPS[STEPS.length - 1];
}

interface RulersProps {
  tableLength: number;
  tableWidth: number;
  step: number;
  fontScale: number;
  strokeWidth: number;
}

export default function Rulers(props: RulersProps) {
  const { tableLength, tableWidth, step, fontScale, strokeWidth } = props;
  const ticksX = Array.from(
    { length: Math.floor(tableLength / step) + 1 },
    (_, index) => index * step,
  );
  const ticksY = Array.from(
    { length: Math.floor(tableWidth / step) + 1 },
    (_, index) => index * step,
  );
  return (
    <g pointerEvents="none">
      {ticksX.map((tick) => (
        <g key={`tick-x-${tick}`}>
          <line x1={tick} y1={-8} x2={tick} y2={0} stroke="#64748b" strokeWidth={strokeWidth} />
          <text x={tick} y={-12} fontSize={fontScale} textAnchor="middle" fill="#475569">
            {tick}
          </text>
        </g>
      ))}
      {ticksY.map((tick) => (
        <g key={`tick-y-${tick}`}>
          <line x1={-8} y1={tick} x2={0} y2={tick} stroke="#64748b" strokeWidth={strokeWidth} />
          <text x={-12} y={tick + fontScale / 3} fontSize={fontScale} textAnchor="end" fill="#475569">
            {tick}
          </text>
        </g>
      ))}
    </g>
  );
}
