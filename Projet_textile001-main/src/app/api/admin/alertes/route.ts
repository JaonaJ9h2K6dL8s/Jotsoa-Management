import { NextResponse } from 'next/server';
import { resolvePeriod } from '@/server/admin/periods';
import { parseReportFilters } from '@/server/admin/filters';
import { transversalAlerts } from '@/server/admin/sections';
import {
  errorResponse,
  rejectCrossOrigin,
  requireAdminGuard,
} from '@/server/admin/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  const cross = rejectCrossOrigin(request);
  if (cross) return cross;
  const guard = await requireAdminGuard();
  if (!guard.ok) return guard.response;
  try {
    const params = new URL(request.url).searchParams;
    const { current } = resolvePeriod(params);
    const filters = parseReportFilters(params);
    return NextResponse.json({
      status: 'ok',
      items: transversalAlerts(filters, current),
    });
  } catch (error) {
    return errorResponse(error, 'Erreur lors du chargement des alertes.');
  }
}
