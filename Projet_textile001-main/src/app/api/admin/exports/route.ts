import { NextResponse } from 'next/server';
import { ServiceError } from '@/server/api/service-error';
import { resolvePeriod } from '@/server/admin/periods';
import { parseReportFilters } from '@/server/admin/filters';
import { resolveSection } from '@/server/admin/sections';
import { buildPdf, buildWorkbook } from '@/server/admin/exports';
import { finalizeReport } from '@/server/admin/report-types';
import {
  errorResponse,
  filtersSummary,
  rejectCrossOrigin,
  requireAdminGuard,
} from '@/server/admin/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Export Excel ou PDF, calculé par les mêmes services que l'interface. */
export async function GET(request: Request): Promise<NextResponse> {
  const cross = rejectCrossOrigin(request);
  if (cross) return cross;
  const guard = await requireAdminGuard();
  if (!guard.ok) return guard.response;
  try {
    const url = new URL(request.url);
    const params = url.searchParams;
    const format = params.get('format') ?? 'excel';
    if (!['excel', 'pdf'].includes(format)) {
      throw new ServiceError('Format d’export inconnu.', 400);
    }
    const section = params.get('section') ?? 'general';
    if (!/^[a-z_]{2,20}$/.test(section)) {
      throw new ServiceError('Section de rapport invalide.', 400);
    }
    const definition = resolveSection(section);
    const { current, previous } = resolvePeriod(params);
    const filters = parseReportFilters(params);
    const built = definition.build({ current, previous, filters });
    const report = finalizeReport(definition, current, previous, built);
    const summary = filtersSummary(params);
    const stamp = new Date().toISOString().slice(0, 10);
    if (format === 'excel') {
      const buffer = buildWorkbook(report, summary);
      return new NextResponse(new Uint8Array(buffer), {
        status: 200,
        headers: {
          'Content-Type':
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="rapport-${section}-${stamp}.xlsx"`,
        },
      });
    }
    const buffer = buildPdf(report, summary);
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="rapport-${section}-${stamp}.pdf"`,
      },
    });
  } catch (error) {
    return errorResponse(error, 'Erreur lors de la génération de l’export.');
  }
}
