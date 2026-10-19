import QRCode from 'qrcode';
import { NextResponse } from 'next/server';
import { requireApiAuth } from '@/server/auth/guards';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Génération d'un QR code (SVG) à partir d'un payload d'identifiant.
 * Le QR code ne transporte aucune donnée sensible et ne remplace jamais
 * l'authentification ni les vérifications de permissions.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const guard = await requireApiAuth();
  if (!guard.ok) return guard.response;
  const url = new URL(request.url);
  const payload = url.searchParams.get('payload') ?? '';
  if (!payload.trim() || payload.length > 200) {
    return NextResponse.json(
      { status: 'error', message: 'Payload QR invalide.' },
      { status: 400 },
    );
  }
  try {
    const svg = await QRCode.toString(payload, {
      type: 'svg',
      margin: 1,
      width: 220,
    });
    return new NextResponse(svg, {
      headers: { 'Content-Type': 'image/svg+xml' },
    });
  } catch {
    return NextResponse.json(
      { status: 'error', message: 'Génération du QR code impossible.' },
      { status: 400 },
    );
  }
}
