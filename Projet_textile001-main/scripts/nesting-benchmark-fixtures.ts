import type { OptimizerPiece } from '../src/lib/cutting/optimizer';

function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

type Shape = 'corps' | 'manche' | 'col' | 'l';

function contour(shape: Shape) {
  switch (shape) {
    case 'corps':
      return [
        { x: 0, y: 10 }, { x: 10, y: 0 }, { x: 48, y: 0 }, { x: 58, y: 10 },
        { x: 58, y: 74 }, { x: 29, y: 76 }, { x: 0, y: 74 },
      ];
    case 'manche':
      return [
        { x: 0, y: 22 }, { x: 6, y: 0 }, { x: 40, y: 0 }, { x: 46, y: 22 },
        { x: 23, y: 17 },
      ];
    case 'col':
      return [
        { x: 0, y: 6 }, { x: 2, y: 1 }, { x: 26, y: 0 }, { x: 50, y: 1 },
        { x: 52, y: 6 }, { x: 26, y: 4 },
      ];
    case 'l':
      return [
        { x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 8 }, { x: 9, y: 8 },
        { x: 9, y: 30 }, { x: 0, y: 30 },
      ];
  }
}

export function makeBenchmarkPieces(count: number): OptimizerPiece[] {
  const rng = makeRng(20261023);
  const shapes: Shape[] = ['corps', 'manche', 'col', 'l'];
  return Array.from({ length: count }, (_, index) => {
    const shape = shapes[Math.floor(rng() * shapes.length)];
    const points = contour(shape);
    return {
      id: index + 1,
      code: `P${String(index + 1).padStart(3, '0')}`,
      label: `Pièce ${index + 1} (${shape})`,
      points: points.map((point) => ({ ...point })),
      qty: 1,
      grainDirection: rng() < 0.7 ? 'along' as const : 'any' as const,
      allowedRotations: [0, 90, 180, 270],
      status: 'configuree' as const,
    };
  });
}
