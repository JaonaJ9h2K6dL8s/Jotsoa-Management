'use client';

import Box from '@mui/material/Box';
import type { MascotId } from '@/lib/mascots/registry';

/**
 * Dessins SVG originaux des mascottes, sans dépendance externe ni CDN.
 * Chaque mascotte est dessinée dans un viewBox 100x100 avec deux yeux
 * (classe « mascot-eye ») que les animations CSS font cligner.
 */

interface MascotArtProps {
  id: MascotId;
  size?: number;
}

function Smile({ x, y, w = 10 }: { x: number; y: number; w?: number }) {
  return (
    <path
      d={`M ${x - w / 2} ${y} Q ${x} ${y + w * 0.45} ${x + w / 2} ${y}`}
      stroke="#26323f"
      strokeWidth={1.8}
      strokeLinecap="round"
      fill="none"
    />
  );
}

function MascotSvg({ id }: { id: MascotId }) {
  switch (id) {
    case 'bobine':
      return (
        <g>
          <rect x={28} y={30} width={44} height={40} rx={6} fill="#c98b4b" />
          <rect x={24} y={26} width={52} height={8} rx={4} fill="#a86e37" />
          <rect x={24} y={66} width={52} height={8} rx={4} fill="#a86e37" />
          {[38, 46, 54, 62].map((y) => (
            <rect key={y} x={30} y={y} width={40} height={4} rx={2} fill="#e8b98a" />
          ))}
          <path
            d="M 72 50 C 86 46, 88 58, 74 60"
            stroke="#1fae74"
            strokeWidth={3}
            fill="none"
            strokeLinecap="round"
          />
          <circle cx={44} cy={46} r={3} fill="#26323f" className="mascot-eye" style={{ transformOrigin: '44px 46px' }} />
          <circle cx={58} cy={46} r={3} fill="#26323f" className="mascot-eye" style={{ transformOrigin: '58px 46px' }} />
          <Smile x={51} y={54} />
        </g>
      );
    case 'ciseaux':
      return (
        <g>
          <circle cx={36} cy={74} r={9} fill="none" stroke="#5b7fd4" strokeWidth={5} />
          <circle cx={64} cy={74} r={9} fill="none" stroke="#5b7fd4" strokeWidth={5} />
          <path d="M 40 68 L 56 30 L 60 34 L 46 70 Z" fill="#8fa9e0" />
          <path d="M 60 68 L 44 30 L 40 34 L 54 70 Z" fill="#a9bee8" />
          <circle cx={50} cy={46} r={4.5} fill="#26323f" className="mascot-eye" style={{ transformOrigin: '50px 46px' }} />
          <circle cx={50} cy={46} r={2} fill="#f4c531" />
        </g>
      );
    case 'tshirt':
      return (
        <g>
          <path
            d="M 32 28 L 44 24 Q 50 30 56 24 L 68 28 L 78 40 L 68 46 L 68 76 L 32 76 L 32 46 L 22 40 Z"
            fill="#3f9e6e"
          />
          <path d="M 44 24 Q 50 32 56 24" stroke="#2f7d54" strokeWidth={3} fill="none" />
          <circle cx={42} cy={48} r={3} fill="#26323f" className="mascot-eye" style={{ transformOrigin: '42px 48px' }} />
          <circle cx={58} cy={48} r={3} fill="#26323f" className="mascot-eye" style={{ transformOrigin: '58px 48px' }} />
          <Smile x={50} y={57} />
          <circle cx={38} cy={64} r={2} fill="#f4c531" />
          <circle cx={62} cy={64} r={2} fill="#f4c531" />
        </g>
      );
    case 'aiguille':
      return (
        <g>
          <path
            d="M 30 82 L 62 24"
            stroke="#b8c4d4"
            strokeWidth={6}
            strokeLinecap="round"
          />
          <ellipse cx={64.5} cy={20} rx={5.5} ry={7} fill="#8fa0b6" transform="rotate(28 64.5 20)" />
          <circle cx={64.5} cy={20.5} r={1.8} fill="#2c3644" />
          <path
            d="M 62 24 C 74 34, 66 52, 50 56 C 60 44, 60 34, 54 30"
            stroke="#1fae74"
            strokeWidth={3}
            fill="none"
            strokeLinecap="round"
          />
          <circle cx={44} cy={62} r={3.2} fill="#26323f" className="mascot-eye" style={{ transformOrigin: '44px 62px' }} />
          <circle cx={52} cy={64} r={3.2} fill="#26323f" className="mascot-eye" style={{ transformOrigin: '52px 64px' }} />
          <Smile x={47} y={70} w={8} />
        </g>
      );
    case 'pelote':
      return (
        <g>
          <circle cx={50} cy={52} r={28} fill="#d9778f" />
          <path d="M 26 44 Q 50 34 74 46" stroke="#b85a74" strokeWidth={3} fill="none" />
          <path d="M 24 58 Q 50 48 76 60" stroke="#b85a74" strokeWidth={3} fill="none" />
          <path d="M 30 70 Q 52 62 72 72" stroke="#b85a74" strokeWidth={3} fill="none" />
          <path d="M 74 60 C 86 58, 90 44, 82 36" stroke="#e3aebd" strokeWidth={3} fill="none" strokeLinecap="round" />
          <circle cx={41} cy={50} r={3} fill="#26323f" className="mascot-eye" style={{ transformOrigin: '41px 50px' }} />
          <circle cx={57} cy={50} r={3} fill="#26323f" className="mascot-eye" style={{ transformOrigin: '57px 50px' }} />
          <Smile x={49} y={59} />
        </g>
      );
    case 'colis':
      return (
        <g>
          <rect x={26} y={40} width={48} height={38} rx={5} fill="#c98b4b" />
          <rect x={22} y={30} width={56} height={14} rx={5} fill="#a86e37" />
          <rect x={45} y={30} width={10} height={48} fill="#f4c531" />
          <rect x={26} y={48} width={48} height={5} fill="#f4c531" opacity={0.75} />
          <circle cx={39} cy={58} r={3} fill="#26323f" className="mascot-eye" style={{ transformOrigin: '39px 58px' }} />
          <circle cx={57} cy={58} r={3} fill="#26323f" className="mascot-eye" style={{ transformOrigin: '57px 58px' }} />
          <Smile x={48} y={66} />
        </g>
      );
    case 'ours':
      return (
        <g>
          <circle cx={32} cy={30} r={9} fill="#8d6748" />
          <circle cx={68} cy={30} r={9} fill="#8d6748" />
          <circle cx={32} cy={30} r={4.5} fill="#c9a284" />
          <circle cx={68} cy={30} r={4.5} fill="#c9a284" />
          <circle cx={50} cy={48} r={28} fill="#a5805e" />
          <ellipse cx={50} cy={58} rx={13} ry={10} fill="#d9c3ab" />
          <path d="M 24 76 Q 50 66 76 76 L 76 84 L 24 84 Z" fill="#3f6ea8" />
          <rect x={44} y={64} width={12} height={4} rx={2} fill="#f4c531" />
          <circle cx={40} cy={42} r={3.2} fill="#26323f" className="mascot-eye" style={{ transformOrigin: '40px 42px' }} />
          <circle cx={60} cy={42} r={3.2} fill="#26323f" className="mascot-eye" style={{ transformOrigin: '60px 42px' }} />
          <ellipse cx={50} cy={53} rx={4} ry={2.8} fill="#26323f" />
          <Smile x={50} y={58} w={9} />
        </g>
      );
  }
}

export default function MascotArt({ id, size = 72 }: MascotArtProps) {
  return (
    <Box
      aria-hidden
      sx={{
        width: size,
        height: size,
        flexShrink: 0,
        '& svg': { width: '100%', height: '100%', display: 'block' },
      }}
    >
      <svg viewBox="0 0 100 100" role="presentation">
        <MascotSvg id={id} />
      </svg>
    </Box>
  );
}
