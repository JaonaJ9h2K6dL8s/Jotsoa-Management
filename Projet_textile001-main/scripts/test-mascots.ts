/**
 * Tests des mascottes personnalisées par utilisateur.
 * Exécution : npm run test:mascots
 * Base temporaire dédiée : data/test-mascots-temp.db (jamais la base réelle).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';

process.env.DATABASE_PATH = './data/test-mascots-temp.db';

function cleanTempDb(): void {
  for (const suffix of ['', '-wal', '-shm']) {
    const path = './data/test-mascots-temp.db' + suffix;
    if (fs.existsSync(path)) fs.unlinkSync(path);
  }
}

async function main(): Promise<void> {
  cleanTempDb();

  const { initDatabase, listAppliedMigrations, runMigrations } = await import(
    '../src/server/db'
  );
  const { getMascotConfig, updateMascotConfig } = await import(
    '../src/server/mascots/mascots'
  );
  const { ServiceError } = await import('../src/server/api/service-error');
  const { defaultMascotConfig, MASCOT_IDS } = await import(
    '../src/lib/mascots/registry'
  );

  const db = initDatabase();

  let passed = 0;
  function check(label: string, fn: () => void): void {
    fn();
    passed += 1;
    console.log(`  ✔ ${label}`);
  }

  // Comptes de test isolés (base temporaire uniquement).
  // Les rôles existent déjà (migration 0002) ; on récupère leurs identifiants.
  const roleRow = (code: string): number => {
    const row = db.prepare('SELECT id FROM roles WHERE code = ?').get(code) as
      | { id: number }
      | undefined;
    assert.ok(row, `Rôle manquant : ${code}`);
    return row.id;
  };
  const adminRoleId = roleRow('admin');
  const coupeRoleId = roleRow('chef_coupe');
  const insertUser = db.prepare(
    `INSERT INTO users (nom, username, password_hash, role_id) VALUES (?, ?, ?, ?)`,
  );
  const adminId = Number(
    insertUser.run('Admin', 'admin-test', 'x', adminRoleId).lastInsertRowid,
  );
  const coupeId = Number(
    insertUser.run('Coupe', 'coupe-test', 'x', coupeRoleId).lastInsertRowid,
  );

  console.log('\n— Migration —');
  check('migration 0023 appliquée exactement une fois', () => {
    const applied = listAppliedMigrations(db).filter((id) =>
      id.startsWith('0023'),
    );
    assert.equal(applied.length, 1);
    runMigrations(db);
    assert.equal(
      listAppliedMigrations(db).filter((id) => id.startsWith('0023')).length,
      1,
    );
  });

  check('contraintes CHECK : mascotte invalide refusée en base', () => {
    assert.throws(() => {
      db.prepare(
        `INSERT INTO user_mascots (user_id, mascot_id) VALUES (?, 'dragon')`,
      ).run(adminId);
    });
  });

  check('clé étrangère : utilisateur inexistant refusé', () => {
    assert.throws(() => {
      db.prepare(
        `INSERT INTO user_mascots (user_id, mascot_id) VALUES (99999, 'ours')`,
      ).run();
    });
  });

  console.log('\n— Configuration par défaut —');
  check('aucune préférence → défaut selon le rôle (admin : ours)', () => {
    const config = getMascotConfig(adminId, 'admin');
    assert.equal(config.mascotId, 'ours');
    assert.equal(config.animationEnabled, true);
    assert.equal(config.animationFrequency, 'normal');
    assert.equal(config.position, 'bas-droite');
    // Rien n'est écrit : la table reste vide.
    const count = db
      .prepare('SELECT COUNT(*) AS n FROM user_mascots')
      .get() as { n: number };
    assert.equal(count.n, 0);
  });

  check('suggestions par défaut distinctes selon le métier', () => {
    assert.equal(defaultMascotConfig('chef_coupe').mascotId, 'ciseaux');
    assert.equal(defaultMascotConfig('chef_couture').mascotId, 'aiguille');
    assert.equal(defaultMascotConfig('chef_stock').mascotId, 'colis');
  });

  console.log('\n— Personnalisation par utilisateur —');
  check("l'administrateur choisit sa mascotte", () => {
    const config = updateMascotConfig(adminId, 'admin', {
      mascotId: 'bobine',
      animationStyle: 'vif',
      animationFrequency: 'frequent',
      position: 'haut-gauche',
    });
    assert.equal(config.mascotId, 'bobine');
    assert.equal(config.animationStyle, 'vif');
    assert.equal(getMascotConfig(adminId, 'admin').mascotId, 'bobine');
  });

  check('le chef de coupe choisit une autre mascotte', () => {
    updateMascotConfig(coupeId, 'chef_coupe', {
      mascotId: 'ciseaux',
      animationStyle: 'calme',
      animationFrequency: 'rare',
      position: 'bas-gauche',
      messagesEnabled: false,
    });
    const config = getMascotConfig(coupeId, 'chef_coupe');
    assert.equal(config.mascotId, 'ciseaux');
    assert.equal(config.animationStyle, 'calme');
    assert.equal(config.messagesEnabled, false);
  });

  check('les choix ne sont pas partagés entre comptes', () => {
    const admin = getMascotConfig(adminId, 'admin');
    const coupe = getMascotConfig(coupeId, 'chef_coupe');
    assert.notEqual(admin.mascotId, coupe.mascotId);
    assert.equal(admin.mascotId, 'bobine');
    assert.equal(coupe.mascotId, 'ciseaux');
  });

  check('les préférences persistent (relecture après écriture)', () => {
    for (let i = 0; i < 3; i += 1) {
      assert.equal(getMascotConfig(adminId, 'admin').position, 'haut-gauche');
    }
  });

  check('mise à jour : une seule configuration active par utilisateur', () => {
    updateMascotConfig(adminId, 'admin', { mascotId: 'pelote' });
    const rows = db
      .prepare('SELECT COUNT(*) AS n FROM user_mascots WHERE user_id = ?')
      .get(adminId) as { n: number };
    assert.equal(rows.n, 1);
    assert.equal(getMascotConfig(adminId, 'admin').mascotId, 'pelote');
  });

  check('toutes les mascottes sont sélectionnables', () => {
    for (const id of MASCOT_IDS) {
      updateMascotConfig(adminId, 'admin', { mascotId: id });
      assert.equal(getMascotConfig(adminId, 'admin').mascotId, id);
    }
  });

  check('désactivation persistante de la mascotte', () => {
    updateMascotConfig(coupeId, 'chef_coupe', { animationEnabled: false });
    assert.equal(getMascotConfig(coupeId, 'chef_coupe').animationEnabled, false);
    updateMascotConfig(coupeId, 'chef_coupe', { animationEnabled: true });
    assert.equal(getMascotConfig(coupeId, 'chef_coupe').animationEnabled, true);
  });

  console.log('\n— Validation des entrées —');
  check('mascotte inconnue refusée (400)', () => {
    assert.throws(
      () => updateMascotConfig(adminId, 'admin', { mascotId: 'licorne' }),
      (error: unknown) =>
        error instanceof ServiceError &&
        error.message.includes('inconnue') &&
        error.status === 400,
    );
  });

  check('style inconnu refusé', () => {
    assert.throws(() =>
      updateMascotConfig(adminId, 'admin', { animationStyle: 'fou' }),
    );
  });

  check('fréquence inconnue refusée', () => {
    assert.throws(() =>
      updateMascotConfig(adminId, 'admin', { animationFrequency: ' permanent' }),
    );
  });

  check('position inconnue refusée', () => {
    assert.throws(() =>
      updateMascotConfig(adminId, 'admin', { position: 'milieu' }),
    );
  });

  check('booléens invalides refusés', () => {
    assert.throws(() =>
      updateMascotConfig(adminId, 'admin', { animationEnabled: 'oui' }),
    );
    assert.throws(() =>
      updateMascotConfig(adminId, 'admin', { messagesEnabled: 1 }),
    );
  });

  check('restauration des valeurs par défaut', () => {
    const defaults = defaultMascotConfig('admin');
    const config = updateMascotConfig(adminId, 'admin', {
      ...defaults,
    });
    assert.deepEqual(config, defaults);
    assert.deepEqual(getMascotConfig(adminId, 'admin'), defaults);
  });

  db.close();
  console.log(`\n${passed} tests réussis.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
