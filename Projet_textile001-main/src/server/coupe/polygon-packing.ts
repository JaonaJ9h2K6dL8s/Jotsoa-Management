import { ServiceError } from '@/server/api/service-error';
import { bounds, grainPermittedRotations, polygonArea, polygonsConflict, transformContour, zonePoints, type FabricZone, type Point } from '@/lib/coupe-geometry';
import type { PatternPiece } from './patterns';
import type { NestingPlacement } from './nesting';

export function permittedRotations(piece: PatternPiece, oneWay: boolean): number[] {
  return grainPermittedRotations(piece.grainDirection, piece.allowedRotations, oneWay);
}

export function packContours(items: PatternPiece[], width: number, length: number, gap: number, margin: number,
  defects: FabricZone[], oneWay: boolean, scaleX: number, scaleY: number, optimize: boolean): NestingPlacement[] {
  if (items.length > 300) throw new ServiceError('Plus de 300 contours par couche : répartissez la production en plusieurs plans.',400);
  const zones = defects.map(zonePoints);
  const sorted = [...items].sort((first, second) => optimize ? polygonArea(second.points) - polygonArea(first.points) || first.id - second.id :
    second.heightCm - first.heightCm || first.id - second.id);
  const placements: NestingPlacement[] = [];
  const separation = gap + 0.001;
  let probes = 0;
  for (const piece of sorted) {
    let chosen: NestingPlacement | null = null;
    let score = Infinity;
    const rotations = permittedRotations(piece, oneWay);
    if (!rotations.length) throw new ServiceError(`Aucune rotation compatible avec le droit-fil et le sens du tissu : ${piece.pieceLabel}.`,400);
    for (const rotation of rotations) {
      const local = transformContour(piece.points, rotation, scaleX, scaleY);
      const box = bounds(local);
      if (box.width > width - 2 * margin || box.height > length - 2 * margin) continue;
      const candidates: Point[] = [{x:margin,y:margin}, {x:width-margin-box.width,y:margin}];
      for (const obstacle of [...placements.map((placement) => placement.points), ...zones]) {
        const occupied = bounds(obstacle);
        candidates.push({x:margin,y:occupied.maxY + separation}, {x:occupied.maxX + separation,y:occupied.minY},
          {x:occupied.minX,y:occupied.maxY + separation}, {x:occupied.minX-box.width-separation,y:occupied.minY});
        if (optimize) {
          const stride = Math.max(1,Math.ceil(obstacle.length / 10));
          const localStride = Math.max(1,Math.ceil(local.length / 10));
          for (let outer = 0; outer < obstacle.length; outer += stride) {
            for (let inner = 0; inner < local.length; inner += localStride) {
              const deltaX = obstacle[outer].x - local[inner].x;
              const deltaY = obstacle[outer].y - local[inner].y;
              candidates.push({x:deltaX + separation,y:deltaY}, {x:deltaX,y:deltaY + separation});
            }
          }
        }
      }
      const unique = new Map(candidates.map((point) => [`${point.x.toFixed(4)}:${point.y.toFixed(4)}`,point]));
      for (const position of [...unique.values()].sort((first,second) => first.y-second.y || first.x-second.x)) {
        if (++probes > 1000000) throw new ServiceError('Limite de recherche atteinte : réduisez le nombre de pièces par plan ou utilisez le placement rapide.',400);
        if (position.x < margin || position.y < margin || position.x + box.width > width - margin + 1e-7 || position.y + box.height > length - margin + 1e-7) continue;
        const candidateScore = (position.y + box.height) * (width + 1) + position.x;
        if (candidateScore >= score) continue;
        const points = local.map((point) => ({x:point.x + position.x,y:point.y + position.y}));
        if (zones.some((zone) => polygonsConflict(points,zone,gap)) || placements.some((placement) => polygonsConflict(points,placement.points,gap))) continue;
        chosen = {patternId:piece.id,pieceCode:piece.pieceCode,pieceLabel:piece.pieceLabel,sizeId:piece.sizeId,sizeNom:piece.sizeNom,
          x:position.x,y:position.y,widthCm:box.width,heightCm:box.height,rotation,points};
        score = candidateScore;
      }
    }
    if (!chosen) throw new ServiceError(`Aucun placement trouvé pour « ${piece.pieceLabel} » (${piece.sizeNom}) : vérifiez largeur, longueur, défauts et orientations. Essayez un matelas plus long, moins de pièces ou l’optimisation ; cette heuristique ne prouve pas l’impossibilité mathématique.`,400);
    placements.push(chosen);
  }
  return placements;
}

export function verifyLayout(placements: NestingPlacement[], width: number, length: number, gap: number, margin: number, defects: FabricZone[]): void {
  const zones = defects.map(zonePoints);
  placements.forEach((placement,index) => {
    if (placement.points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < margin-1e-7 || point.y < margin-1e-7 || point.x > width-margin+1e-7 || point.y > length-margin+1e-7)) throw new ServiceError(`Pièce hors du tissu ou de la marge : ${placement.pieceLabel}.`,400);
    if (zones.some((zone) => polygonsConflict(placement.points,zone,gap))) throw new ServiceError(`Pièce sur un défaut ou une zone interdite : ${placement.pieceLabel}.`,400);
    if (placements.slice(0,index).some((other) => polygonsConflict(placement.points,other.points,gap))) throw new ServiceError(`Chevauchement ou espacement insuffisant : ${placement.pieceLabel}.`,400);
  });
}
