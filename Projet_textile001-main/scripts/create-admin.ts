/**
 * Création du premier administrateur — JO Management.
 *
 * Usage (depuis la racine du projet) :
 *   set ADMIN_INITIAL_USERNAME=admin.jo
 *   set ADMIN_INITIAL_PASSWORD=********
 *   npm run create-admin
 *
 * Si les variables ne sont pas définies, le script demande
 * l'identifiant et le mot de passe en saisie masquée.
 * Refuse de créer un compte si un administrateur existe déjà.
 */

import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import {
  validateNom,
  validatePassword,
  validateUsername,
} from '../src/lib/validation';
import { hashPassword } from '../src/server/auth/passwords';
import { sessionsDb } from '../src/server/auth/sessions';
import { writeAudit } from '../src/server/auth/audit';

async function promptHidden(question: string): Promise<string> {
  process.stderr.write(question);
  return new Promise((resolve) => {
    const chars: string[] = [];
    input.setRawMode(true);
    input.resume();
    const onData = (chunk: Buffer) => {
      const char = chunk.toString('utf8');
      if (char === '\r' || char === '\n') {
        input.setRawMode(false);
        input.pause();
        input.removeListener('data', onData);
        process.stderr.write('\n');
        resolve(chars.join(''));
        return;
      }
      if (char === '\u0003') {
        process.exit(1);
      }
      if (char === '\u007F' || char === '\b') {
        chars.pop();
        return;
      }
      chars.push(char);
    };
    input.on('data', onData);
  });
}

async function resolveCredentials(): Promise<{ username: string; password: string }> {
  let username = process.env.ADMIN_INITIAL_USERNAME?.trim() ?? '';
  let password = process.env.ADMIN_INITIAL_PASSWORD ?? '';
  if (!username || !password) {
    const rl = createInterface({ input, output });
    username = (await rl.question('Identifiant administrateur : ')).trim();
    rl.close();
    password = await promptHidden('Mot de passe initial (saisie masquée) : ');
  }
  return { username, password };
}

async function main(): Promise<void> {
  const { username, password } = await resolveCredentials();

  const errors = [
    validateNom('Administrateur'),
    validateUsername(username),
    validatePassword(password),
  ].filter((error): error is string => error !== null);
  if (errors.length > 0) {
    process.stderr.write(`Saisie invalide :\n- ${errors.join('\n- ')}\n`);
    process.exit(1);
  }

  const db = sessionsDb();
  const roleId = (
    db.prepare("SELECT id FROM roles WHERE code = 'admin'").get() as
      | { id: number }
      | undefined
  )?.id;
  if (!roleId) {
    process.stderr.write('Table roles absente : lancez la migration 0002.\n');
    process.exit(1);
  }

  const existing = db
    .prepare(
      `SELECT COUNT(*) AS n FROM users u JOIN roles r ON r.id = u.role_id
       WHERE r.code = 'admin'`,
    )
    .get() as { n: number };
  if (existing.n > 0) {
    process.stderr.write(
      'Refusé : un administrateur existe déjà. Utilisez la gestion des utilisateurs.\n',
    );
    process.exit(1);
  }

  const create = db.transaction(() => {
    const result = db
      .prepare(
        `INSERT INTO users (nom, username, password_hash, role_id, is_active, must_change_password)
         VALUES ('Administrateur', ?, ?, ?, 1, 1)`,
      )
      .run(username.toLowerCase(), hashPassword(password), roleId);
    writeAudit(db, {
      action: 'ADMIN_BOOTSTRAP',
      targetUserId: Number(result.lastInsertRowid),
      details: { username: username.toLowerCase(), mode: 'create-admin' },
    });
  });
  create();

  process.stdout.write(
    `Administrateur « ${username.toLowerCase()} » créé.\n` +
      'Le changement de mot de passe sera exigé à la première connexion.\n',
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    `Erreur : ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
