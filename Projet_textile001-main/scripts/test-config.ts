/**
 * Tests de la configuration générale (étape 3).
 * Exécution : npm run test:config
 * Base temporaire dédiée : data/test-config-temp.db.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';

process.env.DATABASE_PATH = './data/test-config-temp.db';

function cleanTempDb(): void {
  for (const suffix of ['', '-wal', '-shm']) {
    const path = './data/test-config-temp.db' + suffix;
    if (fs.existsSync(path)) fs.unlinkSync(path);
  }
}

async function main(): Promise<void> {
  cleanTempDb();

  const { sessionsDb } = await import('../src/server/auth/sessions');
  void sessionsDb;
  const { SIMPLE_ENTITIES } = await import('../src/server/config/definitions');
  const {
    createReference,
    updateReference,
    setReferenceActive,
    listReference,
  } = await import('../src/server/config/reference');
  const { createReworkZone, updateReworkZone } = await import(
    '../src/server/config/rework-zones'
  );
  const { createDefect, updateDefect } = await import('../src/server/config/defects');
  const {
    listSewingRooms,
    createSewingLine,
    updateSewingLine,
    updateSewingRoom,
    listSewingLines,
  } = await import('../src/server/config/sewing');
  const { createCadence, updateCadence, findApplicableCadence } = await import(
    '../src/server/config/cadences'
  );
  const { listSettings, updateSettings } = await import('../src/server/config/settings');
  const { getDashboardData } = await import('../src/server/config/dashboard');
  const { ServiceError } = await import('../src/server/api/service-error');
  type Actor = import('../src/server/users/users-service').Actor;

  const ADMIN = { id: null, roleCode: 'admin' } as Actor;
  const NON_ADMIN = { id: 2, roleCode: 'chef_coupe' } as Actor;

  let passed = 0;

  function check(label: string, fn: () => void): void {
    fn();
    passed += 1;
    console.log(`  ✔ ${label}`);
  }

  function throwsService(fn: () => void, status: number): void {
    assert.throws(
      fn,
      (error: unknown) => error instanceof ServiceError && error.status === status,
    );
  }

  console.log('— Initialisation');

  check('migration 0003 appliquée : 3 salles créées une seule fois', () => {
    const rooms = listSewingRooms();
    assert.equal(rooms.length, 3);
    assert.equal(new Set(rooms.map((room) => room.code)).size, 3);
  });

  check('données de référence initiales (11 types, 6 couleurs, 6 tailles)', () => {
    // 11 = 6 catégories actives (migration 0011) + 5 anciens types désactivés.
    assert.equal(listReference(SIMPLE_ENTITIES['product-types']).length, 11);
    assert.equal(listReference(SIMPLE_ENTITIES.colors).length, 6);
    assert.equal(listReference(SIMPLE_ENTITIES.sizes).length, 6);
  });

  console.log('— Types de produits');

  check('création, modification, recherche et désactivation d\'un type', () => {
    const created = createReference(SIMPLE_ENTITIES['product-types'], ADMIN, {
      nom: 'Veste',
      description: 'Test création',
    });
    assert.ok(created.id > 0);
    const updated = updateReference(SIMPLE_ENTITIES['product-types'], ADMIN, created.id, {
      nom: 'Veste réversible',
    });
    assert.equal(updated.nom, 'Veste réversible');
    assert.equal(
      listReference(SIMPLE_ENTITIES['product-types'], { search: 'révers' }).length,
      1,
    );
    const deactivated = setReferenceActive(
      SIMPLE_ENTITIES['product-types'],
      ADMIN,
      created.id,
      false,
    );
    assert.equal(deactivated.isActive, false);
  });

  check('doublon de type refusé (normalisation casse/espaces)', () => {
    throwsService(
      () => createReference(SIMPLE_ENTITIES['product-types'], ADMIN, { nom: 't-shirt' }),
      409,
    );
    throwsService(
      () => createReference(SIMPLE_ENTITIES['product-types'], ADMIN, { nom: '  T-Shirt  ' }),
      409,
    );
    throwsService(
      () => createReference(SIMPLE_ENTITIES['product-types'], ADMIN, { nom: 'A' }),
      400,
    );
  });

  console.log('— Couleurs et tailles');

  check('couleur : hex valide accepté, invalide refusé, doublon refusé', () => {
    const color = createReference(SIMPLE_ENTITIES.colors, ADMIN, {
      nom: 'Jaune',
      hex_code: '#FFD400',
    });
    assert.equal((color as unknown as { hexCode: string }).hexCode, '#FFD400');
    throwsService(
      () => createReference(SIMPLE_ENTITIES.colors, ADMIN, { nom: 'Or', hex_code: 'jaune' }),
      400,
    );
    throwsService(
      () => createReference(SIMPLE_ENTITIES.colors, ADMIN, { nom: 'NOIR' }),
      409,
    );
  });

  check('taille : ordre invalide refusé ; désactivation sans suppression', () => {
    throwsService(
      () => createReference(SIMPLE_ENTITIES.sizes, ADMIN, { nom: 'XXXL', display_order: 0 }),
      400,
    );
    const sizes = listReference(SIMPLE_ENTITIES.sizes);
    const xs = sizes.find((size) => size.nom === 'XS') as { id: number };
    setReferenceActive(SIMPLE_ENTITIES.sizes, ADMIN, xs.id, false);
    const after = listReference(SIMPLE_ENTITIES.sizes);
    assert.equal(after.length, sizes.length);
    assert.equal(after.find((size) => size.id === xs.id)?.isActive, false);
  });

  console.log('— Zones de retouche');

  check('zone : association types, doublon refusé, type inconnu refusé', () => {
    const types = listReference(SIMPLE_ENTITIES['product-types']);
    const tshirt = types.find((type) => type.nom === 'T-shirt') as { id: number };
    const zone = createReworkZone(ADMIN, {
      nom: 'Boutonnière',
      displayOrder: 12,
      productTypeIds: [tshirt.id],
    });
    assert.deepEqual(zone.productTypeIds, [tshirt.id]);
    throwsService(() => createReworkZone(ADMIN, { nom: 'boutonnière' }), 409);
    const updated = updateReworkZone(ADMIN, zone.id, { nom: 'Boutonnière poitrine' });
    assert.equal(updated.nom, 'Boutonnière poitrine');
    throwsService(
      () => updateReworkZone(ADMIN, zone.id, { productTypeIds: [99999] }),
      400,
    );
  });

  console.log('— Défauts');

  check('défaut : associations, codes et libellés uniques', () => {
    const types = listReference(SIMPLE_ENTITIES['product-types']);
    const zone = createReworkZone(ADMIN, { nom: 'Fermeture', displayOrder: 13 });
    const defect = createDefect(ADMIN, {
      code: 'DEF-010',
      nom: 'Fermeture cassée',
      category: 'Finition',
      productTypeIds: [types[0].id],
      zoneIds: [zone.id],
    });
    assert.equal(defect.productTypeIds.length, 1);
    assert.equal(defect.zoneIds.length, 1);
    throwsService(() => createDefect(ADMIN, { code: 'def-010', nom: 'Autre' }), 409);
    throwsService(
      () => createDefect(ADMIN, { code: 'DEF-011', nom: 'Fermeture cassée' }),
      409,
    );
    assert.equal(updateDefect(ADMIN, defect.id, { category: 'Accessoires' }).category, 'Accessoires');
    throwsService(() => createDefect(ADMIN, { code: 'X', nom: 'Valide' }), 400);
  });

  console.log('— Salles et lignes');

  check('plusieurs lignes par salle ; code unique par salle', () => {
    const room = listSewingRooms()[0];
    const line1 = createSewingLine(ADMIN, { code: 'L1', nom: 'Ligne 1', roomId: room.id });
    const line2 = createSewingLine(ADMIN, { code: 'L2', nom: 'Ligne 2', roomId: room.id });
    assert.ok(line1.id !== line2.id);
    throwsService(
      () => createSewingLine(ADMIN, { code: 'l1', nom: 'Doublon', roomId: room.id }),
      409,
    );
  });

  check('salle inexistante ou désactivée refusée pour une ligne', () => {
    throwsService(
      () => createSewingLine(ADMIN, { code: 'L9', nom: 'Fantôme', roomId: 99999 }),
      400,
    );
    const rooms = listSewingRooms();
    updateSewingRoom(ADMIN, rooms[2].id, { isActive: false });
    throwsService(
      () => createSewingLine(ADMIN, { code: 'L8', nom: 'Salle fermée', roomId: rooms[2].id }),
      400,
    );
    updateSewingRoom(ADMIN, rooms[2].id, { isActive: true });
  });

  check('déplacement d\'une ligne vers une autre salle refusé (traçabilité)', () => {
    const lines = listSewingLines();
    const rooms = listSewingRooms();
    const line = lines[0];
    const otherRoom = rooms.find((room) => room.id !== line.roomId) as { id: number };
    throwsService(
      () => updateSewingLine(ADMIN, line.id, { roomId: otherRoom.id }),
      400,
    );
  });

  console.log('— Cadences');

  check('cadence valide créée ; conflit de contexte refusé', () => {
    const types = listReference(SIMPLE_ENTITIES['product-types']);
    const cadence = createCadence(ADMIN, {
      productTypeId: types[0].id,
      value: 120,
      unit: 'pièces/heure',
      period: 'heure',
      startDate: '2026-01-01',
    });
    assert.ok(cadence.id > 0);
    throwsService(
      () =>
        createCadence(ADMIN, {
          productTypeId: types[0].id,
          value: 150,
          unit: 'pièces/heure',
          period: 'heure',
          startDate: '2026-02-01',
        }),
      409,
    );
  });

  check('valeurs de cadence invalides refusées', () => {
    throwsService(
      () =>
        createCadence(ADMIN, {
          value: 0,
          unit: 'pièces/heure',
          period: 'heure',
          startDate: '2026-01-01',
        }),
      400,
    );
    throwsService(
      () =>
        createCadence(ADMIN, {
          value: 100,
          unit: '',
          period: 'semaine',
          startDate: '2026-01-01',
        }),
      400,
    );
    throwsService(
      () =>
        createCadence(ADMIN, {
          value: 100,
          unit: 'pièces/heure',
          period: 'jour',
          startDate: '2026-01-01',
          endDate: '2025-01-01',
        }),
      400,
    );
  });

  check('priorité ligne > salle > global ; réactivation gérée', () => {
    const roomA = listSewingRooms()[0];
    const line = listSewingLines({ roomId: roomA.id })[0];
    const globalCadence = createCadence(ADMIN, {
      value: 100,
      unit: 'pièces/jour',
      period: 'jour',
      startDate: '2026-01-01',
    });
    const lineCadence = createCadence(ADMIN, {
      roomId: roomA.id,
      lineId: line.id,
      value: 200,
      unit: 'pièces/jour',
      period: 'jour',
      startDate: '2026-01-01',
    });
    assert.equal(findApplicableCadence(null, roomA.id, line.id)?.id, lineCadence.id);
    updateCadence(ADMIN, lineCadence.id, { isActive: false });
    assert.equal(findApplicableCadence(null, roomA.id, line.id)?.id, globalCadence.id);
    assert.equal(updateCadence(ADMIN, lineCadence.id, { isActive: true }).isActive, true);
    throwsService(
      () =>
        createCadence(ADMIN, {
          value: 90,
          unit: 'pièces/jour',
          period: 'jour',
          startDate: '2026-03-01',
        }),
      409,
    );
  });

  console.log('— Paramètres généraux');

  check('lecture et modification des paramètres autorisés', () => {
    assert.ok(listSettings().length >= 4);
    const updated = updateSettings(ADMIN, {
      company_name: 'JO Textile',
      default_page_size: '50',
    });
    assert.equal(updated.find((row) => row.key === 'company_name')?.value, 'JO Textile');
    throwsService(() => updateSettings(ADMIN, { default_page_size: '5' }), 400);
    throwsService(() => updateSettings(ADMIN, { unknown_key: 'x' }), 400);
    throwsService(() => updateSettings(ADMIN, { company_name: '' }), 400);
  });

  console.log('— Sécurité');

  check('un utilisateur non administrateur ne peut rien modifier', () => {
    throwsService(
      () => createReference(SIMPLE_ENTITIES['product-types'], NON_ADMIN, { nom: 'Fraude' }),
      403,
    );
    throwsService(() => createReworkZone(NON_ADMIN, { nom: 'Fraude zone' }), 403);
    throwsService(() => createDefect(NON_ADMIN, { code: 'DEF-099', nom: 'Fraude' }), 403);
    throwsService(
      () => createSewingLine(NON_ADMIN, { code: 'LF', nom: 'Fraude', roomId: 1 }),
      403,
    );
    throwsService(() => updateSettings(NON_ADMIN, { company_name: 'Fraude' }), 403);
  });

  check('tableau de bord : compteurs réels et listes cohérentes', () => {
    const data = getDashboardData();
    assert.equal(data.counters.sewingRooms, 3);
    assert.ok(data.counters.productTypes >= 5);
    assert.ok(data.counters.defects >= 7);
    assert.ok(Array.isArray(data.alerts));
    assert.ok(Array.isArray(data.recentOperations));
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
        fs.unlinkSync('./data/test-config-temp.db' + suffix);
      } catch {
        // ignoré
      }
    }
  });
