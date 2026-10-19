/**
 * Reinitialisation des mots de passe des comptes de test admin et
 * chef.coupe avec le hachage du projet. Usage : npx tsx scripts/reset-accounts.ts
 */
import { sessionsDb } from '../src/server/auth/sessions';
import { hashPassword } from '../src/server/auth/passwords';

const db = sessionsDb();
const accounts: Array<{ username: string; password: string }> = [
  { username: 'admin', password: 'Admin1234!' },
  { username: 'chef.coupe', password: 'Coupe1234!' },
];

const update = db.prepare(
  "UPDATE users SET password_hash = ?, must_change_password = 0, is_active = 1 WHERE username = ?",
);

for (const account of accounts) {
  const result = update.run(hashPassword(account.password), account.username);
  console.log(`${account.username}: ${result.changes === 1 ? 'OK' : 'INTROUVABLE'}`);
}
