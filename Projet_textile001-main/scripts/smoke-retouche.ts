/**
 * Smoke HTTP du module Retouche (étape 7) sur le build de production.
 * Usage : tsx scripts/smoke-retouche.ts setup|verify|cleanup
 * Crée des utilisateurs éphémères, vérifie les garde-fous HTTP,
 * puis supprime les utilisateurs de test.
 */

import Database from 'better-sqlite3';

const DB_PATH = './data/jo-test-admin.db';
const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:3457';
const mode = process.argv[2] ?? 'verify';

async function main(): Promise<void> {
  const db = new Database(DB_PATH);

  function userIdFor(roleCode: string, username: string): number {
    const row = db
      .prepare(
        `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
       WHERE r.code = ? AND u.username = ?`,
      )
      .get(roleCode, username) as { id: number } | undefined;
    if (row) return row.id;
    return Number(
      db
        .prepare(
          `INSERT INTO users (nom, prenom, username, password_hash, role_id, is_active, must_change_password)
         SELECT 'Smoke', 'RT', ?, 'x', r.id, 1, 0 FROM roles r WHERE r.code = ?`,
        )
        .run(username, roleCode).lastInsertRowid,
    );
  }

  if (mode === 'setup') {
    const { hashPassword } = await import('../src/server/auth/passwords');
    const roles = [
      ['retoucheur', 'smoke-rt'],
      ['chef_coupe', 'smoke-cp'],
      ['controleur_qualite', 'smoke-cq'],
    ] as const;
    for (const [roleCode, username] of roles) {
      const id = userIdFor(roleCode, username);
      db.prepare('UPDATE users SET password_hash = ?, is_active = 1 WHERE id = ?').run(
        hashPassword('Smoke-2024!'),
        id,
      );
    }
    console.log('setup ok');
  } else if (mode === 'cleanup') {
    for (const username of ['smoke-rt', 'smoke-cp', 'smoke-cq']) {
      db.prepare('DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = ?)').run(username);
      db.prepare('DELETE FROM users WHERE username = ?').run(username);
    }
    console.log('cleanup ok');
  } else {
    async function api(path: string, init?: RequestInit): Promise<Response> {
      return fetch(BASE + path, { ...init, redirect: 'manual' });
    }

    let failures = 0;
    function expect(label: string, actual: unknown, expected: unknown): void {
      const ok = actual === expected;
      if (!ok) failures += 1;
      console.log(`  ${ok ? '✔' : '✘'} ${label} (attendu ${expected}, obtenu ${actual})`);
    }

    // Migration 0007 appliquée au démarrage du serveur.
    const migrations = db
      .prepare('SELECT id FROM schema_migrations WHERE id = ?')
      .get('0007_retouche.sql') as { id: string } | undefined;
    expect('migration 0007_retouche.sql appliquée', migrations?.id ?? 'absente', '0007_retouche.sql');
    const rtTables = db
      .prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name LIKE 'rt_%'")
      .get() as { n: number };
    if (rtTables.n < 8) failures += 1;
    console.log(`  ${rtTables.n >= 8 ? '✔' : '✘'} tables rt_* présentes (${rtTables.n})`);

    // Anonyme : API protégée → 401.
    const anonApi = await api('/api/retouche/dashboard');
    expect('API anonyme refusée (401)', anonApi.status, 401);

    // Connexion retoucheur.
    const login = await api('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'smoke-rt', password: 'Smoke-2024!' }),
    });
    expect('connexion retoucheur (200)', login.status, 200);
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];

    const rtChecks: Array<[string, string, number]> = [
      ['GET /api/retouche/dashboard', '/api/retouche/dashboard', 200],
      ['GET /api/retouche/requests', '/api/retouche/requests', 200],
      ['GET /api/retouche/assignments', '/api/retouche/assignments', 200],
      ['GET /api/retouche/interventions', '/api/retouche/interventions', 200],
      ['GET /api/retouche/returns', '/api/retouche/returns', 200],
      ['GET /api/retouche/rebuts', '/api/retouche/rebuts', 200],
      ['GET /api/retouche/history', '/api/retouche/history', 200],
      ['GET /api/retouche/references', '/api/retouche/references', 200],
      ['GET /retouche (page)', '/retouche', 200],
    ];
    for (const [label, path, expected] of rtChecks) {
      const res = await api(path, { headers: { cookie } });
      expect(label, res.status, expected);
    }

    // Rôle étranger : accès refusé côté serveur.
    const loginCp = await api('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'smoke-cp', password: 'Smoke-2024!' }),
    });
    const cookieCp = (loginCp.headers.get('set-cookie') ?? '').split(';')[0];
    const cpApi = await api('/api/retouche/dashboard', { headers: { cookie: cookieCp } });
    expect('API retouche refusée pour chef_coupe (403)', cpApi.status, 403);

    // CQ : consultation des propositions de rebut autorisée.
    const loginCq = await api('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'smoke-cq', password: 'Smoke-2024!' }),
    });
    const cookieCq = (loginCq.headers.get('set-cookie') ?? '').split(';')[0];
    const cqApi = await api('/api/retouche/rebuts', { headers: { cookie: cookieCq } });
    expect('API rebuts accessible au CQ (200)', cqApi.status, 200);
    const cqDecision = await api('/api/retouche/rebuts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: cookieCq },
      body: JSON.stringify({ action: 'decide', proposalId: 999999, decision: 'approve' }),
    });
    expect('décision CQ sur proposal inexistante (404)', cqDecision.status, 404);

    // Le retoucheur ne peut pas décider d'un rebut.
    const rtDecision = await api('/api/retouche/rebuts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ action: 'decide', proposalId: 999999, decision: 'approve' }),
    });
    expect('décision rebut refusée au retoucheur (403)', rtDecision.status, 403);

    if (failures > 0) {
      console.error(`\nSMOKE ÉCHOUÉ : ${failures} échec(s).`);
      process.exitCode = 1;
    } else {
      console.log('\nSmoke HTTP retouche : OK.');
    }
  }

  db.close();
}

main().catch((error: unknown) => {
  console.error('SMOKE ERREUR :', error);
  process.exit(1);
});
