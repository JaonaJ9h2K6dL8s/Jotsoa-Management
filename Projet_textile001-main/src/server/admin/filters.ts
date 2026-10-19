import { ServiceError } from '@/server/api/service-error';

/**
 * Filtres communs des rapports admin : validés côté serveur, appliqués
 * en SQL. Seuls les filtres pertinents sont exposés par section.
 */

export interface ReportFilters {
  lotId: number | null;
  productId: number | null;
  colorId: number | null;
  sizeId: number | null;
  roomId: number | null;
  lineId: number | null;
  userId: number | null;
  status: string | null;
  severity: string | null;
  orderRef: string | null;
  cartonId: number | null;
  locationId: number | null;
  anomalyType: string | null;
}

function idParam(params: URLSearchParams, key: string): number | null {
  const raw = params.get(key);
  if (raw === null || raw === '') return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new ServiceError(`Filtre ${key} invalide.`, 400);
  }
  return value;
}

function textParam(params: URLSearchParams, key: string, max: number): string | null {
  const raw = params.get(key);
  if (raw === null || raw === '') return null;
  const value = raw.trim();
  if (value.length > max) {
    throw new ServiceError(`Filtre ${key} trop long.`, 400);
  }
  return value;
}

const STATUS_PATTERN = /^[a-z_]{2,40}$/;

export function parseReportFilters(params: URLSearchParams): ReportFilters {
  const status = textParam(params, 'status', 40);
  if (status && !STATUS_PATTERN.test(status)) {
    throw new ServiceError('Filtre de statut invalide.', 400);
  }
  const severity = textParam(params, 'severity', 10);
  if (severity && !['info', 'warning', 'critical'].includes(severity)) {
    throw new ServiceError('Gravité inconnue.', 400);
  }
  const anomalyType = textParam(params, 'anomalyType', 40);
  if (anomalyType && !STATUS_PATTERN.test(anomalyType)) {
    throw new ServiceError('Type d’anomalie invalide.', 400);
  }
  return {
    lotId: idParam(params, 'lotId'),
    productId: idParam(params, 'productId'),
    colorId: idParam(params, 'colorId'),
    sizeId: idParam(params, 'sizeId'),
    roomId: idParam(params, 'roomId'),
    lineId: idParam(params, 'lineId'),
    userId: idParam(params, 'userId'),
    status,
    severity,
    orderRef: textParam(params, 'orderRef', 60),
    cartonId: idParam(params, 'cartonId'),
    locationId: idParam(params, 'locationId'),
    anomalyType,
  };
}

/** Ajoute les conditions SQL des filtres de dimension partagés. */
export function dimensionWhere(
  filters: ReportFilters,
  columns: Partial<{
    lotId: string;
    productId: string;
    colorId: string;
    sizeId: string;
    roomId: string;
    lineId: string;
    userId: string;
  }>,
): { where: string; args: unknown[] } {
  const clauses: string[] = [];
  const args: unknown[] = [];
  const bind = (sql: string | undefined, value: number | null): void => {
    if (sql && value !== null) {
      clauses.push(`${sql} = ?`);
      args.push(value);
    }
  };
  bind(columns.lotId, filters.lotId);
  bind(columns.productId, filters.productId);
  bind(columns.colorId, filters.colorId);
  bind(columns.sizeId, filters.sizeId);
  bind(columns.roomId, filters.roomId);
  bind(columns.lineId, filters.lineId);
  bind(columns.userId, filters.userId);
  return { where: clauses.join(' AND '), args };
}

/** Variante sur une table liée au lot (coupe_lots pour produit/couleur). */
export function lotDimensionWhere(
  filters: ReportFilters,
  columns: { lotId?: string; productId?: string; colorId?: string },
): { where: string; args: unknown[] } {
  return dimensionWhere(filters, {
    lotId: columns.lotId,
    productId: columns.productId,
    colorId: columns.colorId,
  });
}

/** Clauses de dimension lot/produit/couleur avec alias de table. */
export function dimWhere(
  filters: ReportFilters,
  alias = 'l',
): { where: string; args: unknown[] } {
  const clauses: string[] = [];
  const args: unknown[] = [];
  if (filters.productId !== null) {
    clauses.push(`${alias}.product_id = ?`);
    args.push(filters.productId);
  }
  if (filters.colorId !== null) {
    clauses.push(`${alias}.color_id = ?`);
    args.push(filters.colorId);
  }
  if (filters.lotId !== null) {
    clauses.push(`${alias}.id = ?`);
    args.push(filters.lotId);
  }
  return { where: clauses.length ? ` AND ${clauses.join(' AND ')}` : '', args };
}
