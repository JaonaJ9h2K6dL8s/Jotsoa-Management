import { NextResponse } from 'next/server';
import { homePathForRole } from '@/lib/permissions';
import { toApiError } from '@/server/api/error-response';
import { isSameOrigin } from '@/server/auth/guards';
import { authenticate, RATE_LIMIT_ERROR } from '@/server/auth/login';
import { isLoginBlocked, loginRateKey } from '@/server/auth/rate-limit';
import { SESSION_COOKIE } from '@/server/auth/sessions';
import type { LoginResponse } from '@/types/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface LoginBody {
  username?: unknown;
  password?: unknown;
}

export async function POST(
  request: Request,
): Promise<NextResponse<LoginResponse>> {
  try {
    if (!isSameOrigin(request)) {
      return NextResponse.json(
        { status: 'error', message: 'Requête non autorisée.' },
        { status: 403 },
      );
    }
    const body = (await request.json().catch(() => null)) as LoginBody | null;
    const username = typeof body?.username === 'string' ? body.username : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    if (!username.trim() || !password) {
      return NextResponse.json(
        { status: 'error', message: "L'identifiant et le mot de passe sont requis." },
        { status: 400 },
      );
    }
    if (isLoginBlocked(loginRateKey(username))) {
      return NextResponse.json(
        { status: 'error', message: RATE_LIMIT_ERROR },
        { status: 429 },
      );
    }

    const result = authenticate(username, password);
    if (!result.ok) {
      return NextResponse.json(
        { status: 'error', message: result.message },
        { status: 401 },
      );
    }

    const redirectTo = result.user.mustChangePassword
      ? '/change-password'
      : homePathForRole(result.user.roleCode);
    const payload: LoginResponse = {
      status: 'ok',
      user: result.user,
      redirectTo,
    };
    const response = NextResponse.json(payload);
    response.cookies.set(SESSION_COOKIE, result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      expires: new Date(result.expiresAt),
    });
    return response;
  } catch (error) {
    return NextResponse.json(
      toApiError(error, 'Erreur inattendue lors de la connexion.'),
      { status: 500 },
    );
  }
}
