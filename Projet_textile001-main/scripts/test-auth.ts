/**
 * Tests d'authentification, de sessions et d'autorisations — JO Management.
 * Exécution : npm run test:auth
 * Les tests tournent sur une base temporaire dédiée (data/test-auth-temp.db)
 * et n'affectent jamais la base de production.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';

process.env.DATABASE_PATH = './data/test-auth-temp.db';
process.env.SESSION_TTL_HOURS = '12';

const BASE = './data/test-auth-temp.db';

function cleanTempDb() {
  for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(BASE + suffix)) fs.unlinkSync(BASE + suffix);
  }
}

async function main() {
  cleanTempDb();
  const { sessionsDb } = await import('../src/server/auth/sessions');
  const { findUserBySessionToken } = await import('../src/server/auth/sessions');
  const { authenticate, logout } = await import('../src/server/auth/login');
  const { hashPassword } = await import('../src/server/auth/passwords');
  const { isLoginBlocked, registerLoginFailure, loginRateKey } = await import(
    '../src/server/auth/rate-limit'
  );
  const { createUser, listUsers } = await import('../src/server/users/users-service');
  const { updateUser, setUserActive, resetUserPassword } = await import(
    '../src/server/users/users-mutations'
  );
  const { ServiceError } = await import('../src/server/api/service-error');

  let passed = 0;
  const db = sessionsDb();

  function check(label: string, fn: () => void) {
    fn();
    passed += 1;
    console.log(`  ✔ ${label}`);
  }

  console.log('— Initialisation');

  check('les 8 rôles sont initialisés sans doublon', () => {
    const rows = db.prepare('SELECT code, COUNT(*) n FROM roles GROUP BY code').all() as {
      code: string;
      n: number;
    }[];
    assert.equal(rows.length, 8);
    assert.equal(
      (db.prepare('SELECT COUNT(*) AS n FROM roles').get() as { n: number }).n,
      8,
    );
  });

  check('création directe du premier administrateur (test)', () => {
    const roleId = (db.prepare("SELECT id FROM roles WHERE code='admin'").get() as { id: number }).id;
    db.prepare(
      "INSERT INTO users (nom, username, password_hash, role_id, is_active, must_change_password) VALUES ('Admin Test', 'admin.test', ?, ?, 1, 0)",
    ).run(hashPassword('MotDePasse123'), roleId);
  });

  console.log('— Authentification');

  check('connexion avec identifiants valides', () => {
    const result = authenticate('admin.test', 'MotDePasse123');
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.user.roleCode, 'admin');
      assert.equal('password_hash' in result.user, false);
      assert.equal('token' in result.user, false);
    }
  });

  check('connexion avec mot de passe incorrect (message générique)', () => {
    const result = authenticate('admin.test', 'mauvais');
    const other = authenticate('inconnu.xy', 'autre');
    assert.equal(result.ok, false);
    assert.equal(other.ok, false);
    if (!result.ok && !other.ok) {
      assert.equal(result.message, other.message);
    }
  });

  check('connexion avec un utilisateur inexistant (message identique)', () => {
    const result = authenticate('inconnu', 'MotDePasse123');
    assert.equal(result.ok, false);
  });

  check('connexion avec un compte désactivé refusée', () => {
    const roleId = (db.prepare("SELECT id FROM roles WHERE code='chef_coupe'").get() as { id: number }).id;
    db.prepare(
      "INSERT INTO users (nom, username, password_hash, role_id, is_active) VALUES ('Inactif', 'inactif.test', ?, ?, 0)",
    ).run(hashPassword('MotDePasse123'), roleId);
    const result = authenticate('inactif.test', 'MotDePasse123');
    assert.equal(result.ok, false);
  });

  check('déconnexion invalide la session (jeton non réutilisable)', () => {
    const result = authenticate('admin.test', 'MotDePasse123');
    assert.ok(result.ok);
    if (!result.ok) return;
    const user1 = findUserBySessionToken(db, result.token);
    assert.ok(user1);
    logout(result.token, result.user.id);
    assert.equal(findUserBySessionToken(db, result.token), null);
  });

  check('session expirée supprimée et refusée', () => {
    db.prepare('DELETE FROM sessions').run();
    const result = authenticate('admin.test', 'MotDePasse123');
    assert.ok(result.ok);
    if (!result.ok) return;
    db.prepare('UPDATE sessions SET expires_at = ?').run(
      new Date(Date.now() - 1000).toISOString(),
    );
    assert.equal(findUserBySessionToken(db, result.token), null);
    assert.equal(
      (db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n,
      0,
    );
  });

  check('désactivation du compte révoque les sessions', () => {
    const created = createUser({ id: 1, roleCode: 'admin' }, {
      nom: 'Coupe Test',
      username: 'coupe.test',
      password: 'MotDePasse123',
      roleCode: 'chef_coupe',
    });
    const result = authenticate('coupe.test', 'MotDePasse123');
    assert.ok(result.ok);
    if (!result.ok) return;
    setUserActive({ id: 1, roleCode: 'admin' }, created.id, false);
    assert.equal(findUserBySessionToken(db, result.token), null);
    const relogin = authenticate('coupe.test', 'MotDePasse123');
    assert.equal(relogin.ok, false);
  });

  check('limitation des tentatives après échecs répétés', () => {
    const key = loginRateKey('rate.test');
    for (let i = 0; i < 8; i += 1) registerLoginFailure(key);
    assert.equal(isLoginBlocked(key), true);
    assert.equal(isLoginBlocked(loginRateKey('autre.test')), false);
  });

  console.log('— Gestion des utilisateurs');

  check("refus d'un identifiant déjà utilisé", () => {
    assert.throws(
      () =>
        createUser({ id: 1, roleCode: 'admin' }, {
          nom: 'Doublon',
          username: 'coupe.test',
          password: 'MotDePasse123',
          roleCode: 'retoucheur',
        }),
      (error: unknown) => error instanceof ServiceError && error.status === 409,
    );
  });

  check('les réponses utilisateur n’exposent aucun hachage', () => {
    for (const user of listUsers()) {
      const serialized = JSON.stringify(user);
      assert.equal(serialized.includes('password'), false);
      assert.equal(serialized.includes('hash'), false);
      assert.equal(serialized.includes('token'), false);
    }
  });

  check('modification de rôle par un administrateur autorisée', () => {
    const [coupeUser] = listUsers().filter((u) => u.username === 'coupe.test');
    setUserActive({ id: 1, roleCode: 'admin' }, coupeUser.id, true);
    const updated = updateUser({ id: 1, roleCode: 'admin' }, coupeUser.id, {
      roleCode: 'retoucheur',
    });
    assert.equal(updated.roleCode, 'retoucheur');
  });

  check('un utilisateur non administrateur ne peut pas gérer les comptes', () => {
    const [coupeUser] = listUsers().filter((u) => u.username === 'coupe.test');
    assert.throws(
      () =>
        createUser({ id: coupeUser.id, roleCode: 'retoucheur' }, {
          nom: 'Pirate',
          username: 'pirate.test',
          password: 'MotDePasse123',
          roleCode: 'retoucheur',
        }),
      (error: unknown) => error instanceof ServiceError && error.status === 403,
    );
  });

  check("un utilisateur ne peut pas modifier son propre rôle", () => {
    const [admin] = listUsers().filter((u) => u.username === 'admin.test');
    assert.throws(
      () =>
        updateUser({ id: admin.id, roleCode: 'admin' }, admin.id, {
          roleCode: 'chef_stock',
        }),
      (error: unknown) => error instanceof ServiceError && error.status === 403,
    );
  });

  check('protection du dernier administrateur actif (désactivation)', () => {
    const [admin] = listUsers().filter((u) => u.username === 'admin.test');
    assert.throws(
      () => setUserActive({ id: admin.id, roleCode: 'admin' }, admin.id, false),
      (error: unknown) => error instanceof ServiceError && error.status === 409,
    );
  });

  check('protection du dernier administrateur actif (changement de rôle)', () => {
    const [admin] = listUsers().filter((u) => u.username === 'admin.test');
    assert.throws(
      () =>
        updateUser({ id: 999, roleCode: 'admin' }, admin.id, {
          roleCode: 'chef_stock',
        }),
      (error: unknown) => error instanceof ServiceError && error.status === 409,
    );
  });

  check('réinitialisation de mot de passe : session révoquée + changement forcé', () => {
    const [retoucheur] = listUsers().filter((u) => u.username === 'coupe.test');
    updateUser({ id: 1, roleCode: 'admin' }, retoucheur.id, { roleCode: 'retoucheur' });
    const result = authenticate('coupe.test', 'MotDePasse123');
    assert.ok(result.ok);
    if (!result.ok) return;
    const reset = resetUserPassword({ id: 1, roleCode: 'admin' }, retoucheur.id);
    assert.ok(reset.temporaryPassword && reset.temporaryPassword.length >= 8);
    assert.equal(findUserBySessionToken(db, result.token), null);
    const relogin = authenticate('coupe.test', reset.temporaryPassword);
    assert.ok(relogin.ok);
    if (relogin.ok) assert.equal(relogin.user.mustChangePassword, true);
  });

  check("journal d'audit : aucun secret enregistré", () => {
    const rows = db
      .prepare('SELECT action, details FROM audit_logs')
      .all() as { action: string; details: string }[];
    assert.ok(rows.length > 0);
    for (const row of rows) {
      assert.equal(row.details.includes('MotDePasse'), false);
      assert.equal(row.details.toLowerCase().includes('token'), false);
      assert.equal(row.details.includes('hash'), false);
    }
  });

  console.log(`\n${passed} test(s) réussi(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error('\nÉCHEC DES TESTS :', error);
    process.exit(1);
  })
  .finally(() => {
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        fs.unlinkSync('./data/test-auth-temp.db' + suffix);
      } catch {
        // ignoré
      }
    }
  });
