import bcrypt from 'bcryptjs';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Hachage et vérification des mots de passe.
 * Nouveaux hachages : scrypt (natif Node, ~50 ms) — bcryptjs en pur
 * JavaScript prenait plusieurs secondes et bloquait la création de
 * compte comme la connexion. Les anciens hachages bcrypt restent
 * vérifiables (compatibilité).
 * Aucun mot de passe en clair n'est jamais stocké ni journalisé.
 */

const SCRYPT_N = 16384;
const SCRYPT_r = 8;
const SCRYPT_p = 1;
const KEY_LEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_r,
    p: SCRYPT_p,
  });
  return [
    'scrypt',
    SCRYPT_N,
    SCRYPT_r,
    SCRYPT_p,
    salt.toString('base64'),
    hash.toString('base64'),
  ].join('$');
}

export function verifyPassword(password: string, hash: string): boolean {
  try {
    if (hash.startsWith('scrypt$')) {
      const [, n, r, p, saltB64, hashB64] = hash.split('$');
      const expected = Buffer.from(hashB64, 'base64');
      const actual = scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, {
        N: Number(n),
        r: Number(r),
        p: Number(p),
      });
      return timingSafeEqual(actual, expected);
    }
    // Anciens hachages bcrypt ($2a$/$2b$) : compatibilité ascendante.
    return bcrypt.compareSync(password, hash);
  } catch {
    return false;
  }
}

/** Mot de passe temporaire lisible généré pour les réinitialisations. */
export function generateTemporaryPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(12);
  let password = '';
  for (const byte of bytes) {
    password += alphabet[byte % alphabet.length];
  }
  return password;
}
