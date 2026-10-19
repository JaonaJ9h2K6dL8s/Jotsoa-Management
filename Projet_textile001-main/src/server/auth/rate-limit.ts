/**
 * Limitation des tentatives de connexion, en mémoire.
 * Adaptée au déploiement mono-processus de l'application (serveur
 * Next.js local) : un redémarrage réinitialise les compteurs.
 */

interface AttemptRecord {
  count: number;
  windowStart: number;
}

const MAX_FAILURES = 8;
const WINDOW_MS = 15 * 60 * 1000;

const attempts = new Map<string, AttemptRecord>();

/** Clé de limitation : identifiant + adresse IP. */
export function loginRateKey(username: string, ip?: string): string {
  return `${username.trim().toLowerCase()}|${ip ?? 'local'}`;
}

function cleanupExpired(now: number): void {
  for (const [key, record] of attempts) {
    if (now - record.windowStart > WINDOW_MS) {
      attempts.delete(key);
    }
  }
}

export function isLoginBlocked(key: string): boolean {
  const record = attempts.get(key);
  if (!record) {
    return false;
  }
  const now = Date.now();
  if (now - record.windowStart > WINDOW_MS) {
    attempts.delete(key);
    return false;
  }
  return record.count >= MAX_FAILURES;
}

export function registerLoginFailure(key: string): void {
  const now = Date.now();
  cleanupExpired(now);
  const record = attempts.get(key);
  if (!record || now - record.windowStart > WINDOW_MS) {
    attempts.set(key, { count: 1, windowStart: now });
    return;
  }
  record.count += 1;
}

export function resetLoginFailures(key: string): void {
  attempts.delete(key);
}

export function remainingAttempts(key: string): number {
  const record = attempts.get(key);
  if (!record) {
    return MAX_FAILURES;
  }
  return Math.max(0, MAX_FAILURES - record.count);
}
