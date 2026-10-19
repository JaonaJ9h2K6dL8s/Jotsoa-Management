import { cookies } from 'next/headers';
import type { SessionUser } from '@/types/auth';
import { SESSION_COOKIE, findUserBySessionToken, sessionsDb } from './sessions';

/**
 * Utilisateur courant, dérivé exclusivement du cookie de session
 * vérifié en base. Aucune confiance accordée au contenu du navigateur
 * (rôle, identifiant ou état client).
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) {
    return null;
  }
  const db = sessionsDb();
  return findUserBySessionToken(db, token);
}

export async function getSessionToken(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(SESSION_COOKIE)?.value ?? null;
}
