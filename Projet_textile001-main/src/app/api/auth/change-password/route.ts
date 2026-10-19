import { NextResponse } from 'next/server';
import { validatePassword } from '@/lib/validation';
import { toApiError } from '@/server/api/error-response';
import { writeAudit } from '@/server/auth/audit';
import { getCurrentUser } from '@/server/auth/current-user';
import { verifyPassword, hashPassword } from '@/server/auth/passwords';
import { sessionsDb } from '@/server/auth/sessions';
import { isSameOrigin } from '@/server/auth/guards';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ChangePasswordBody {
  currentPassword?: unknown;
  newPassword?: unknown;
}

/** Changement de mot de passe par l'utilisateur connecté. */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const guardError = !isSameOrigin(request)
      ? 'Requête non autorisée.'
      : null;
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { status: 'error', message: 'Authentification requise.' },
        { status: 401 },
      );
    }
    if (guardError) {
      return NextResponse.json(
        { status: 'error', message: guardError },
        { status: 403 },
      );
    }
    const body = (await request.json().catch(() => null)) as
      | ChangePasswordBody
      | null;
    const currentPassword =
      typeof body?.currentPassword === 'string' ? body.currentPassword : '';
    const newPassword =
      typeof body?.newPassword === 'string' ? body.newPassword : '';
    const error = validatePassword(newPassword);
    if (!currentPassword || error) {
      return NextResponse.json(
        { status: 'error', message: error ?? 'Mot de passe actuel requis.' },
        { status: 400 },
      );
    }

    const db = sessionsDb();
    const row = db
      .prepare('SELECT password_hash FROM users WHERE id = ?')
      .get(user.id) as { password_hash: string } | undefined;
    if (!row || !verifyPassword(currentPassword, row.password_hash)) {
      return NextResponse.json(
        { status: 'error', message: 'Mot de passe actuel incorrect.' },
        { status: 400 },
      );
    }
    db.prepare(
      `UPDATE users SET password_hash = ?, must_change_password = 0,
              updated_at = ? WHERE id = ?`,
    ).run(hashPassword(newPassword), new Date().toISOString(), user.id);
    writeAudit(db, {
      action: 'PASSWORD_CHANGED',
      actorUserId: user.id,
      targetUserId: user.id,
    });
    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    return NextResponse.json(
      toApiError(error, 'Erreur lors du changement de mot de passe.'),
      { status: 500 },
    );
  }
}
