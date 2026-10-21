export interface Point { x: number; y: number }
export interface FabricZone { x: number; y: number; widthCm: number; heightCm: number; label: string }
const EPS = 1e-7;

export function polygonArea(points: Point[]): number {
  return Math.abs(points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0)) / 2;
}

export function bounds(points: Point[]) {
  const minX = Math.min(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxX = Math.max(...points.map((point) => point.x));
  const maxY = Math.max(...points.map((point) => point.y));
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

function cross(first: Point, second: Point, third: Point): number {
  return (second.x - first.x) * (third.y - first.y) - (second.y - first.y) * (third.x - first.x);
}

function onSegment(point: Point, start: Point, end: Point): boolean {
  return Math.abs(cross(start, end, point)) < EPS && point.x >= Math.min(start.x, end.x) - EPS &&
    point.x <= Math.max(start.x, end.x) + EPS && point.y >= Math.min(start.y, end.y) - EPS && point.y <= Math.max(start.y, end.y) + EPS;
}

function intersects(first: Point, second: Point, third: Point, fourth: Point): boolean {
  const sides = [cross(first, second, third), cross(first, second, fourth), cross(third, fourth, first), cross(third, fourth, second)];
  return (sides[0] * sides[1] < -EPS && sides[2] * sides[3] < -EPS) ||
    onSegment(first, third, fourth) || onSegment(second, third, fourth) || onSegment(third, first, second) || onSegment(fourth, first, second);
}

export function pointInside(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    if (onSegment(point, start, end)) return true;
    if ((start.y > point.y) !== (end.y > point.y) && point.x < (end.x - start.x) * (point.y - start.y) / (end.y - start.y) + start.x) inside = !inside;
  }
  return inside;
}

function distanceToSegment(point: Point, start: Point, end: Point): number {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const lengthSquared = deltaX ** 2 + deltaY ** 2;
  const fraction = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) / lengthSquared));
  return Math.hypot(point.x - start.x - fraction * deltaX, point.y - start.y - fraction * deltaY);
}

export function polygonsConflict(first: Point[], second: Point[], gap = 0): boolean {
  const firstBox = bounds(first);
  const secondBox = bounds(second);
  if (firstBox.maxX + gap < secondBox.minX - EPS || secondBox.maxX + gap < firstBox.minX - EPS ||
      firstBox.maxY + gap < secondBox.minY - EPS || secondBox.maxY + gap < firstBox.minY - EPS) return false;
  for (let firstIndex = 0; firstIndex < first.length; firstIndex += 1) {
    const start = first[firstIndex];
    const end = first[(firstIndex + 1) % first.length];
    for (let secondIndex = 0; secondIndex < second.length; secondIndex += 1) {
      const otherStart = second[secondIndex];
      const otherEnd = second[(secondIndex + 1) % second.length];
      if (intersects(start, end, otherStart, otherEnd)) return true;
      if (gap > 0 && Math.min(distanceToSegment(start, otherStart, otherEnd), distanceToSegment(end, otherStart, otherEnd),
        distanceToSegment(otherStart, start, end), distanceToSegment(otherEnd, start, end)) < gap - EPS) return true;
    }
  }
  return pointInside(first[0], second) || pointInside(second[0], first);
}

export function geometryError(points: Point[]): string | null {
  if (!Array.isArray(points) || points.length < 3 || points.length > 500) return 'Un contour doit contenir entre 3 et 500 sommets.';
  if (points.some((point) => !point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || Math.abs(point.x) > 10000 || Math.abs(point.y) > 10000)) return 'Coordonnées non finies ou hors limites.';
  if (polygonArea(points) <= EPS) return 'Contour sans surface.';
  for (let index = 0; index < points.length; index += 1) {
    const next = (index + 1) % points.length;
    if (Math.hypot(points[index].x - points[next].x, points[index].y - points[next].y) < EPS) return 'Sommets consécutifs identiques.';
    for (let other = index + 1; other < points.length; other += 1) {
      const otherNext = (other + 1) % points.length;
      if (other === next || otherNext === index) continue;
      if (intersects(points[index], points[next], points[other], points[otherNext])) return 'Contour auto-intersecté.';
    }
  }
  return null;
}

export function transformContour(points: Point[], rotation: number, scaleX = 1, scaleY = 1): Point[] {
  const radians = rotation * Math.PI / 180;
  const rotated = points.map((point) => ({ x: (point.x * Math.cos(radians) - point.y * Math.sin(radians)) * scaleX,
    y: (point.x * Math.sin(radians) + point.y * Math.cos(radians)) * scaleY }));
  const box = bounds(rotated);
  return rotated.map((point) => ({ x: point.x - box.minX, y: point.y - box.minY }));
}

export function zonePoints(zone: FabricZone): Point[] {
  return [{ x: zone.x, y: zone.y }, { x: zone.x + zone.widthCm, y: zone.y },
    { x: zone.x + zone.widthCm, y: zone.y + zone.heightCm }, { x: zone.x, y: zone.y + zone.heightCm }];
}

export function labelAnchor(points: Point[]): Point {
  const box = bounds(points);
  const middleY = (box.minY + box.maxY) / 2;
  const intersections: number[] = [];
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length];
    if ((point.y > middleY) !== (next.y > middleY)) intersections.push(point.x + (middleY - point.y) * (next.x - point.x) / (next.y - point.y));
  });
  intersections.sort((first, second) => first - second);
  let anchor = points[0];
  let longest = 0;
  for (let index = 0; index + 1 < intersections.length; index += 2) {
    const width = intersections[index + 1] - intersections[index];
    if (width > longest) { longest = width; anchor = { x: (intersections[index] + intersections[index + 1]) / 2, y: middleY }; }
  }
  return anchor;
}

export function grainPermittedRotations(grainDirection: string, allowedRotations: number[], oneWay: boolean): number[] {
  const byGrain = grainDirection === 'along' ? [0, 180] : grainDirection === 'cross' ? [90, 270] : [0, 90, 180, 270];
  return allowedRotations.filter((rotation) => byGrain.includes(rotation) && (!oneWay || rotation === 0));
}
