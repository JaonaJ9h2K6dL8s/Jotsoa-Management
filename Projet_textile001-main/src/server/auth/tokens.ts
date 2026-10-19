import { createHash, randomBytes } from 'node:crypto';

/**
 * Jetons de session : générés cryptographiquement aléatoires côté serveur.
 * Seule l'empreinte SHA-256 du jeton est stockée en base ; le jeton
 * lui-même ne vit que dans le cookie HttpOnly du navigateur.
 */

export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
