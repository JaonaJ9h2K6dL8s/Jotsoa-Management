import { NextResponse } from 'next/server';
import {
  createManualOrder,
  getDocument,
  importDocument,
  listDocuments,
  rejectDocument,
} from '@/server/magasinier/documents';
import {
  errorResponse,
  rejectCrossOrigin,
  requireMagasinierGuard,
} from '@/server/magasinier/route-helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const guard = await requireMagasinierGuard();
  if (!guard.ok) return guard.response;
  try {
    return NextResponse.json({
      status: 'ok',
      items: listDocuments(guard.actor),
    });
  } catch (error) {
    return errorResponse(error, 'Erreur lors du chargement des documents.');
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const guard = await requireMagasinierGuard();
  if (!guard.ok) return guard.response;
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;
  try {
    const contentType = request.headers.get('content-type') ?? '';
    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      const file = form.get('file');
      if (!(file instanceof File)) {
        return NextResponse.json(
          { status: 'error', message: 'Aucun fichier PDF fourni.' },
          { status: 400 },
        );
      }
      if (file.type && file.type !== 'application/pdf') {
        return NextResponse.json(
          { status: 'error', message: 'Seuls les fichiers PDF sont acceptés.' },
          { status: 400 },
        );
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      const result = await importDocument(guard.actor, {
        name: file.name,
        buffer,
      });
      return NextResponse.json({ status: 'ok', item: result }, { status: 201 });
    }
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? '');
    if (action === 'manualOrder') {
      const item = createManualOrder(guard.actor, body);
      return NextResponse.json({ status: 'ok', item }, { status: 201 });
    }
    if (action === 'reject') {
      rejectDocument(guard.actor, body);
      return NextResponse.json({ status: 'ok' });
    }
    if (action === 'get') {
      const item = getDocument(guard.actor, Number(body.documentId));
      return NextResponse.json({ status: 'ok', item });
    }
    return NextResponse.json(
      { status: 'error', message: 'Action inconnue.' },
      { status: 400 },
    );
  } catch (error) {
    return errorResponse(error, "Erreur lors de l'opération sur le document.");
  }
}
