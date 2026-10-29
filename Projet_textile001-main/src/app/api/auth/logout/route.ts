import { NextResponse } from 'next/server';
import { toApiError } from '@/server/api/error-response';
import { getSessionToken, getCurrentUser } from '@/server/auth/current-user';
import { logout } from '@/server/auth/login';
import { SESSION_COOKIE } from '@/server/auth/sessions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Invalide la session côté serveur puis supprime le cookie. */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const token = await getSessionToken();
    if (token) {
      const user = await getCurrentUser();
      logout(token, user?.id);
    }
    const isHttps = new URL(request.url).protocol === 'https:';
    const response = NextResponse.json({ status: 'ok' });
    response.cookies.set(SESSION_COOKIE, '', {
      httpOnly: true,
      secure: isHttps,
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    });
    return response;
  } catch (error) {
    return NextResponse.json(
      toApiError(error, 'Erreur lors de la déconnexion.'),
      { status: 500 },
    );
  }
}
