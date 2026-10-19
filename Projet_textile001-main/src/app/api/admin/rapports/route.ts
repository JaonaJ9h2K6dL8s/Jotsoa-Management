import { NextResponse } from 'next/server';
import { ServiceError } from '@/server/api/service-error';
import { resolvePeriod } from '@/server/admin/periods';
import { parseReportFilters } from '@/server/admin/filters';
import { resolveSection } from '@/server/admin/sections';
import { finalizeReport } from '@/server/admin/report-types';
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
    const url = new URL(request.url);
    const params = url.searchParams;
    const section = params.get('section') ?? 'general';
    if (!/^[a-z_]{2,20}$/.test(section)) {
      throw new ServiceError('Section de rapport invalide.', 400);
    }
    const definition = resolveSection(section);
    const { current, previous } = resolvePeriod(params);
    const filters = parseReportFilters(params);
    const built = definition.build({ current, previous, filters });
    return NextResponse.json({
      status: 'ok',
      item: finalizeReport(definition, current, previous, built),
    });
  } catch (error) {
    return errorResponse(error, 'Erreur lors du calcul du rapport.');
  }
}
