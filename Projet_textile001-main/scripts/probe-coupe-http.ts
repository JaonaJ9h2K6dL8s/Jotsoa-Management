/**
 * Sonde de diagnostic : création d'une tâche de coupe via la vraie API
 * HTTP. Base isolée — aucune donnée utilisateur n'est touchée.
 * Usage : node/tsx scripts/probe-coupe-http.ts puis appeler le serveur.
 */
process.env.DATABASE_PATH = './data/probe-coupe.db';

import fs from 'node:fs';

import type { Actor } from '../src/server/users/users-service';

function cleanDb(): void {
  for (const suffix of ['', '-wal', '-shm']) {
    const path = './data/probe-coupe.db' + suffix;
    if (fs.existsSync(path)) fs.unlinkSync(path);
  }
}

async function main(): Promise<void> {
  cleanDb();
  const { sessionsDb } = await import('../src/server/auth/sessions');
  const db = sessionsDb();
  const { hashPassword } = await import('../src/server/auth/passwords');

  const userId = (roleCode: string, username: string, password: string) => {
    const role = db.prepare('SELECT id FROM roles WHERE code = ?').get(roleCode) as { id: number };
    return Number(
      db
        .prepare(
          `INSERT INTO users (nom, prenom, username, password_hash, role_id, is_active, must_change_password)
           VALUES ('Probe','Test',?,?,?,1,0)`,
        )
        .run(username, hashPassword(password), role.id).lastInsertRowid,
    );
  };

  const chefId = userId('chef_coupe', 'probe-coupe', 'Probe-2026!');
  userId('admin', 'probe-admin', 'Probe-2026!');

  const actor: Actor = { id: chefId, roleCode: 'chef_coupe' };
  const { createRoll } = await import('../src/server/coupe/rolls');
  const { createLot } = await import('../src/server/coupe/lots');
  const { patchLot } = await import('../src/server/coupe/lots');

  const typeId = (db.prepare('SELECT id FROM product_types LIMIT 1').get() as { id: number }).id;
  const productId = Number(
    db.prepare('INSERT INTO products (nom, description, product_type_id) VALUES (?,?,?)')
      .run('Sonde', 'probe', typeId).lastInsertRowid,
  );
  const colorId = (db.prepare('SELECT id FROM colors WHERE is_active=1 LIMIT 1').get() as { id: number }).id;
  const sizeIds = (db.prepare('SELECT id FROM sizes WHERE is_active=1 ORDER BY display_order LIMIT 2').all() as Array<{id:number}>).map(r => r.id);

  const roll = createRoll(actor, {
    code: 'RO-PROBE-001',
    fabricRef: 'FB-PROBE',
    initialWeightKg: 12,
  } as Record<string, unknown>);

  const lot = createLot(actor, {
    productId,
    colorId,
    sizes: sizeIds.map((id) => ({ sizeId: id, plannedQty: 10 })),
  } as Record<string, unknown>);

  patchLot(actor, lot.id, { action: 'start' });

  console.log(`PROBE_READY lotId=${lot.id} rollId=${roll.id}`);
}

main().catch((e) => {
  console.error('PROBE_SEED_ERREUR', e);
  process.exit(1);
});
