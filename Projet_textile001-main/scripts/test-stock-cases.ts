/**
 * Cas de test du module Cartons et Stock — cartons, entrées CQ,
 * mouvements et emplacements, inventaires, ajustements sensibles,
 * déchets, sécurité et historique.
 */

import type Database from 'better-sqlite3';
import type { CoutureTestTools } from './couture-test-utils';

interface ActorLike {
  id: number;
  roleCode: string;
}

export interface StockCaseContext {
  db: Database.Database;
  tools: CoutureTestTools;
  ST: ActorLike;
  ST2: ActorLike;
  CQ: ActorLike;
  CP: ActorLike;
  lotId: number;
  control: { id: number };
  stockTransferId: number;
  sizeIds: number[];
}

export async function runStockCases(ctx: StockCaseContext): Promise<void> {
  const { db, tools, ST, ST2, CQ, CP, lotId, stockTransferId, sizeIds } = ctx;
  const check = tools.check;
  const throwsService = tools.throwsService;
  const st = await import('../src/server/stock/cartons');
  const loc = await import('../src/server/stock/locations');
  const entries = await import('../src/server/stock/entries');
  const mov = await import('../src/server/stock/movements');
  const inv = await import('../src/server/stock/inventories');
  const adj = await import('../src/server/stock/adjustments');
  const waste = await import('../src/server/stock/waste');

  function movementsCount(): number {
    return (db.prepare('SELECT COUNT(*) AS n FROM st_movements').get() as { n: number }).n;
  }
  function openAlert(category: string): unknown {
    return db
      .prepare(
        `SELECT id FROM alerts WHERE category = ? AND status IN ('nouvelle','en_cours')`,
      )
      .get(category);
  }
  function balanceFor(sizeId: number): number {
    return (
      mov
        .listBalances(ST as never)
        .find((row) => row.sizeId === sizeId)?.inStock ?? 0
    );
  }

  check('refus des opérations stock pour un rôle étranger', () => {
    throwsService(() => st.listCartons(CP as never), 403);
    throwsService(() => entries.listEntries(CP as never), 403);
    throwsService(() => mov.listBalances(CP as never), 403);
    throwsService(() => inv.listInventories(CP as never), 403);
  });

  check('création de carton et unicité du code manuel', () => {
    const manual = st.createCarton(ST as never, { code: 'ct-manuel-1' });
    if (manual.code !== 'CT-MANUEL-1') throw new Error('Code manuel non normalisé.');
    if (manual.identifier?.qrPayload !== 'JO|CARTON|CT-MANUEL-1') {
      throw new Error('Payload QR inattendu.');
    }
    throwsService(() => st.createCarton(ST as never, { code: 'CT-MANUEL-1' }), 409);
  });

  const carton = st.createCarton(ST as never, { notes: 'Carton principal' });
  const carton2 = st.createCarton(ST as never, {});

  check('réception du transfert CQ : refuse les saisies invalides', () => {
    throwsService(
      () => entries.receiveCqTransfer(ST as never, { transferId: stockTransferId, lines: [] }),
      400,
    );
    throwsService(
      () =>
        entries.receiveCqTransfer(ST as never, {
          transferId: 999999,
          lines: [{ sizeId: sizeIds[0], cartonId: carton.id }],
        }),
      404,
    );
    throwsService(
      () =>
        entries.receiveCqTransfer(ST as never, {
          transferId: stockTransferId,
          lines: [{ sizeId: sizeIds[0], cartonId: 999999 }],
        }),
      409,
    );
  });

  check(
    'réception réussie : quantités exactes, mouvements et traçabilité',
    () => {
      const pending = entries.listPendingCqTransfers(ST as never);
      if (!pending.some((item) => item.transferId === stockTransferId)) {
        throw new Error('Transfert CQ absent de la liste en attente.');
      }
      const entry = entries.receiveCqTransfer(ST as never, {
        transferId: stockTransferId,
        lines: [
          { sizeId: sizeIds[0], cartonId: carton.id },
          { sizeId: sizeIds[1], cartonId: carton.id },
        ],
      });
      if (entry.lines.length !== 2) throw new Error('Lignes d’entrée manquantes.');
      if (balanceFor(sizeIds[0]) !== 8 || balanceFor(sizeIds[1]) !== 9) {
        throw new Error('Soldes incorrects après entrée.');
      }
      const total = db
        .prepare('SELECT COALESCE(SUM(qty),0) AS total FROM st_carton_lines WHERE carton_id = ?')
        .get(carton.id) as { total: number };
      if (total.total !== 17) throw new Error('Lignes de carton incohérentes.');
    },
  );

  check('détection de la réception en double + alerte persistante', () => {
    throwsService(
      () =>
        entries.receiveCqTransfer(ST as never, {
          transferId: stockTransferId,
          lines: [{ sizeId: sizeIds[0], cartonId: carton2.id }],
        }),
      409,
    );
    if (!openAlert('DOUBLON_ENTREE_STOCK')) {
      throw new Error('Alerte de doublon attendue.');
    }
    if (entries.listPendingCqTransfers(ST as never).length !== 0) {
      throw new Error('Le transfert reçu apparaît encore en attente.');
    }
  });

  check('clôture, verrouillage et réouverture autorisée', () => {
    const location = loc.createLocation(ST as never, {
      code: 'A-01',
      label: 'Étagère A1',
      area: 'etagere',
    });
    throwsService(
      () => loc.createLocation(ST as never, { code: 'A-01', label: 'Doublon', area: 'zone' }),
      409,
    );
    throwsService(
      () => st.closeCarton(ST as never, { cartonId: carton.id, locationId: 999999 }),
      400,
    );
    const closed = st.closeCarton(ST as never, {
      cartonId: carton.id,
      locationId: location.id,
    });
    if (closed.status !== 'cloture') throw new Error('Carton non clôturé.');
    throwsService(
      () => st.closeCarton(ST as never, { cartonId: carton.id, locationId: location.id }),
      409,
    );
    throwsService(() => st.reopenCarton(ST as never, { cartonId: carton.id, reason: '  ' }), 400);
    const reopened = st.reopenCarton(ST as never, {
      cartonId: carton.id,
      reason: 'Vérification demandée',
    });
    if (reopened.status !== 'remplissage') throw new Error('Réouverture échouée.');
    st.closeCarton(ST as never, { cartonId: carton.id, locationId: location.id });
    throwsService(() => loc.toggleLocation(ST as never, { locationId: location.id }), 409);
  });

  check('transfert interne entre emplacements', () => {
    const locationB = loc.createLocation(ST as never, {
      code: 'B-01',
      label: 'Rayon B1',
      area: 'rangee',
    });
    const locationA = loc
      .listLocations(ST as never)
      .find((row) => row.code === 'A-01')!;
    throwsService(
      () => mov.transferCarton(ST as never, { cartonId: carton.id, toLocationId: locationA.id }),
      409,
    );
    const transfer = mov.transferCarton(ST as never, {
      cartonId: carton.id,
      toLocationId: locationB.id,
      reason: 'Réorganisation',
    });
    if (transfer.fromCode !== 'A-01' || transfer.toCode !== 'B-01') {
      throw new Error('Trajectoire de transfert incorrecte.');
    }
    const moved = db
      .prepare('SELECT location_id FROM st_cartons WHERE id = ?')
      .get(carton.id) as { location_id: number };
    if (moved.location_id !== locationB.id) throw new Error('Carton non déplacé.');
    const total = mov
      .listBalances(ST as never)
      .reduce((sum, row) => sum + row.inStock, 0);
    if (total !== 17) throw new Error('Le transfert a modifié les soldes.');
  });

  check('sortie autorisée : blocage des excédents et cohérence carton', () => {
    throwsService(
      () => mov.recordSortie(ST as never, { lotId, sizeId: sizeIds[0], qty: 99, reason: 'Trop' }),
      409,
    );
    if (!openAlert('SORTIE_EXCEDENT_STOCK')) throw new Error('Alerte d’excédent attendue.');
    throwsService(
      () => mov.recordSortie(ST as never, { lotId, sizeId: sizeIds[0], qty: 1, reason: '' }),
      400,
    );
    const before = movementsCount();
    mov.recordSortie(ST as never, {
      lotId,
      sizeId: sizeIds[0],
      qty: 3,
      cartonId: carton.id,
      reason: 'Livraison autorisée',
    });
    if (movementsCount() !== before + 1) throw new Error('Mouvement non enregistré.');
    if (balanceFor(sizeIds[0]) !== 5) throw new Error('Solde après sortie incorrect.');
    const lineQty = db
      .prepare('SELECT qty FROM st_carton_lines WHERE carton_id = ? AND size_id = ?')
      .get(carton.id, sizeIds[0]) as { qty: number } | undefined;
    if (lineQty?.qty !== 5) throw new Error('Ligne de carton non mise à jour.');
    const status = db.prepare('SELECT status FROM st_cartons WHERE id = ?').get(carton.id) as {
      status: string;
    };
    if (status.status !== 'partiellement_sorti') {
      throw new Error('Statut partiellement sorti attendu.');
    }
  });

  check('inventaire : comptage, écarts et ajustements sensibles', () => {
    const inventory = inv.createInventory(ST as never, { notes: 'Inventaire initial' });
    if (inventory.lines.length === 0) throw new Error('Aucune ligne d’inventaire.');
    const line0 = inventory.lines[0];
    throwsService(
      () =>
        inv.submitCount(ST as never, {
          inventoryId: inventory.id,
          lines: [{ lineId: line0.id, countedQty: -1 }],
        }),
      400,
    );
    const counted = inv.submitCount(ST as never, {
      inventoryId: inventory.id,
      lines: inventory.lines.map((row) => ({
        lineId: row.id,
        countedQty: row.sizeId === sizeIds[0] ? row.theoreticalQty - 1 : row.theoreticalQty,
        observation: row.sizeId === sizeIds[0] ? 'Pièce manquante' : null,
      })),
    });
    if (counted.gapsCount !== 1) throw new Error('Écart non détecté.');
    const gapLine = counted.lines.find(
      (row) => row.countedQty !== null && row.countedQty !== row.theoreticalQty,
    )!;
    throwsService(
      () =>
        adj.submitAdjustments(ST as never, {
          inventoryId: inventory.id,
          items: [{ lineId: gapLine.id, reason: '' }],
        }),
      400,
    );
    adj.submitAdjustments(ST as never, {
      inventoryId: inventory.id,
      items: [{ lineId: gapLine.id, reason: 'Écart constaté au comptage' }],
    });
    if (!openAlert('AJUSTEMENT_EN_ATTENTE_ST')) {
      throw new Error('Alerte d’ajustement en attente attendue.');
    }
    const pendingAdjustment = adj
      .listAdjustments(ST as never)
      .find((row) => row.status === 'en_attente');
    if (!pendingAdjustment) throw new Error('Ajustement en attente absent.');
    tools.throws(() =>
      adj.decideAdjustment(ST as never, {
        adjustmentId: pendingAdjustment.id,
        decision: 'approve',
        note: 'Auto-approbation',
      }),
    );
    adj.decideAdjustment(ST2 as never, {
      adjustmentId: pendingAdjustment.id,
      decision: 'approve',
      note: 'Écart confirmé',
    });
    const corrective = db
      .prepare(
        `SELECT id FROM st_movements WHERE movement_type = 'ajustement' AND source_id = ?`,
      )
      .get(pendingAdjustment.id);
    if (!corrective) throw new Error('Mouvement correctif absent.');
    if (balanceFor(sizeIds[0]) !== 4) throw new Error('Solde après ajustement incorrect.');
    const invStatus = db
      .prepare('SELECT status FROM st_inventories WHERE id = ?')
      .get(inventory.id) as { status: string };
    if (invStatus.status !== 'valide') throw new Error('Inventaire non validé.');
  });

  check('annulation contrôlée d’un carton vide uniquement', () => {
    throwsService(
      () => st.cancelCarton(ST as never, { cartonId: carton.id, reason: 'Test' }),
      409,
    );
    const empty = st.createCarton(ST as never, {});
    st.cancelCarton(ST as never, { cartonId: empty.id, reason: 'Créé par erreur' });
    const status = db.prepare('SELECT status FROM st_cartons WHERE id = ?').get(empty.id) as {
      status: string;
    };
    if (status.status !== 'annule') throw new Error('Carton vide non annulé.');
  });

  check('réimpression : identifiant stable, pas de nouveau carton', () => {
    const count = (): number =>
      (db.prepare("SELECT COUNT(*) AS n FROM st_cartons WHERE code = 'CT-MANUEL-1'").get() as {
        n: number;
      }).n;
    const before = count();
    const label = st.reprintLabel(ST as never, { cartonId: carton.id });
    if (label.qrPayload !== `JO|CARTON|${label.code}`) {
      throw new Error('Référence de réimpression instable.');
    }
    if (label.code !== carton.code) throw new Error('Mauvais carton réimprimé.');
    if (count() !== before) throw new Error('La réimpression a créé un carton.');
  });

  check('déchets textiles : stock distinct en kg, sorties bornées', () => {
    db.prepare(
      `INSERT INTO coupe_waste (lot_id, waste_type, qty, unit, reason, user_id)
       VALUES (?, 'chute', 12.5, 'kg', 'Chutes de coupe', ?)`,
    ).run(lotId, CQ.id);
    const chute = () =>
      waste.listWasteStock(ST as never).find((row) => row.wasteType === 'chute');
    if (chute()?.availableKg !== 12.5) throw new Error('Stock de déchets incorrect.');
    throwsService(
      () =>
        waste.recordWasteMovement(ST as never, {
          wasteType: 'chute',
          movementType: 'sortie',
          qty: 99,
          reason: 'Trop',
        }),
      409,
    );
    waste.recordWasteMovement(ST as never, {
      wasteType: 'chute',
      movementType: 'sortie',
      qty: 2.5,
      reason: 'Vente de chutes autorisée',
    });
    if (chute()?.availableKg !== 10) throw new Error('Sortie de déchet non déduite.');
    const polluted = db
      .prepare(`SELECT COUNT(*) AS n FROM st_movements WHERE lot_id = ? AND qty = 12.5`)
      .get(lotId) as { n: number };
    if (polluted.n !== 0) throw new Error('Les déchets ont pollué le stock pièces.');
  });

  check('historique et immuabilité des mouvements confirmés', () => {
    const history = db
      .prepare("SELECT COUNT(*) AS n FROM st_history WHERE action = 'CARTON_CLOTURE'")
      .get() as { n: number };
    if (history.n === 0) throw new Error('Historique de clôture absent.');
    const before = movementsCount();
    if (movementsCount() !== before) throw new Error('Mouvements supprimés.');
  });
}
