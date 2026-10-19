/**
 * Cas de test Couture — partie 1 : réceptions et affectations.
 */

import type { CoutureTestTools } from './couture-test-utils';

export interface CoutureTestContext {
  db: import('better-sqlite3').Database;
  CHEF: import('../src/server/users/users-service').Actor;
  CHEF2: import('../src/server/users/users-service').Actor;
  STOCK: import('../src/server/users/users-service').Actor;
  productId: number;
  colorId: number;
  sizeIds: number[];
  rooms: number[];
  lots: {
    A: { lotId: number; transferId: number };
    B: { lotId: number; transferId: number };
    C: { lotId: number; transferId: number };
    D: { lotId: number; transferId: number };
    E: { lotId: number; transferId: number };
  };
}

interface CoutureModules {
  receptions: typeof import('../src/server/couture/receptions');
  assignments: typeof import('../src/server/couture/assignments');
  balances: typeof import('../src/server/couture/balances');
}

export let modules: CoutureModules;

export async function runCoutureCases1(
  ctx: CoutureTestContext,
  tools: CoutureTestTools,
): Promise<void> {
  const { check, throwsService, throws } = tools;
  modules = {
    receptions: await import('../src/server/couture/receptions'),
    assignments: await import('../src/server/couture/assignments'),
    balances: await import('../src/server/couture/balances'),
  };

  const { receptions, assignments, balances } = modules;
  const { lines } = { lines: await import('../src/server/couture/lines') };
  const pending = () => balances.listPendingTransfers(ctx.CHEF);

  // La base temporaire ne contient aucune ligne : on les crée via le
  // service (ce qui couvre aussi la création de lignes).
  for (const roomId of ctx.rooms) {
    try {
      lines.createLine(ctx.CHEF, {
        roomId,
        code: `LIG-${roomId}-1`,
        nom: `Ligne 1 — salle ${roomId}`,
      });
    } catch {
      // déjà créée (relance) : ignoré
    }
  }

  check('création de lignes de production persistée dans SQLite', () => {
    for (const roomId of ctx.rooms) {
      const line = ctx.db
        .prepare('SELECT id FROM sewing_lines WHERE room_id = ? AND is_active = 1 LIMIT 1')
        .get(roomId) as { id: number } | undefined;
      if (!line) throw new Error(`Aucune ligne active pour la salle ${roomId}.`);
    }
  });

  check('refus de code de ligne en doublon', () => {
    throwsService(
      () =>
        lines.createLine(ctx.CHEF, {
          roomId: ctx.rooms[0],
          code: 'LIG-1-1',
          nom: 'Doublon',
        }),
      409,
    );
  });
  const firstActiveLine = (roomId: number): number =>
    (
      ctx.db
        .prepare('SELECT id FROM sewing_lines WHERE room_id = ? AND is_active = 1 LIMIT 1')
        .get(roomId) as { id: number } | undefined
    )?.id ?? 0;

  check('les transferts annulés côté Coupe ne sont pas réceptionnables', () => {
    if (pending().some((item) => item.transferId === ctx.lots.E.transferId)) {
      throw new Error('Le transfert annulé apparaît dans la liste.');
    }
  });

  check("réception d'un transfert confirmé : OK, lot « à affecter »", () => {
    const reception = receptions.receiveTransfer(ctx.CHEF, {
      transferId: ctx.lots.A.transferId,
      lines: [
        { sizeId: ctx.sizeIds[0], receivedQty: '10' },
        { sizeId: ctx.sizeIds[1], receivedQty: '10' },
      ],
    });
    if (reception.status !== 'complete') throw new Error('Statut attendu : complete.');
    const lotStatus = ctx.db
      .prepare('SELECT status FROM couture_lot_status WHERE lot_id = ?')
      .get(ctx.lots.A.lotId) as { status: string };
    if (lotStatus.status !== 'a_affecter') {
      throw new Error(`Statut du lot inattendu : ${lotStatus.status}`);
    }
  });

  check("refus d'un transfert annulé côté Coupe", () => {
    throwsService(
      () =>
        receptions.receiveTransfer(ctx.CHEF, {
          transferId: ctx.lots.E.transferId,
          lines: [],
        }),
      400,
    );
  });

  check('détection d’une réception en double', () => {
    throwsService(
      () =>
        receptions.receiveTransfer(ctx.CHEF, {
          transferId: ctx.lots.A.transferId,
          lines: [{ sizeId: ctx.sizeIds[0], receivedQty: '10' }],
        }),
      409,
    );
  });

  check('refus d’une quantité reçue supérieure à la quantité transférée', () => {
    throwsService(
      () =>
        receptions.receiveTransfer(ctx.CHEF, {
          transferId: ctx.lots.B.transferId,
          lines: [{ sizeId: ctx.sizeIds[0], receivedQty: '999' }],
        }),
      400,
    );
  });

  check('réception partielle : écart tracé, alerte et quantités contestées', () => {
    const reception = receptions.receiveTransfer(ctx.CHEF, {
      transferId: ctx.lots.B.transferId,
      lines: [
        { sizeId: ctx.sizeIds[0], receivedQty: '8' },
        { sizeId: ctx.sizeIds[1], receivedQty: '0' },
      ],
      notes: 'Colis ouvert à la livraison.',
    });
    if (reception.status !== 'partielle') throw new Error('Statut attendu : partielle.');
    const alert = ctx.db
      .prepare(
        `SELECT id FROM alerts WHERE category = 'ECART_RECEPTION' AND object_id = ? AND status IN ('nouvelle','en_cours')`,
      )
      .get(ctx.lots.B.lotId);
    if (!alert) throw new Error('Alerte ECART_RECEPTION attendue.');
    const balance = balances
      .getLotBalances(ctx.CHEF)
      .find((lot) => lot.lotId === ctx.lots.B.lotId);
    // Contesté total = (8 − 8) + (8 − 0) = 8 : rien n'est affectable
    // tant que l'écart n'est pas résolu.
    if (!balance || balance.contestedQty !== 8) {
      throw new Error(`Contesté attendu 8, obtenu ${balance?.contestedQty}`);
    }
    if (balance.availableToAssign !== 0) {
      throw new Error(`Disponible attendu 0, obtenu ${balance.availableToAssign}`);
    }
    const sizes = balances.getLotSizeBalances(ctx.CHEF, ctx.lots.B.lotId);
    const size0 = sizes.find((size) => size.sizeId === ctx.sizeIds[0]);
    const size1 = sizes.find((size) => size.sizeId === ctx.sizeIds[1]);
    if (!size0 || size0.received !== 8 || size0.contested !== 0) {
      throw new Error('Soldes taille 0 incohérents.');
    }
    if (!size1 || size1.received !== 0 || size1.contested !== 8) {
      throw new Error('Soldes taille 1 incohérents.');
    }
  });

  check('dédoublonnage des alertes : pas de doublon pour un même incident', () => {
    const count = (
      ctx.db
        .prepare(
          `SELECT COUNT(*) AS total FROM alerts WHERE category = 'ECART_RECEPTION' AND object_id = ?`,
        )
        .get(ctx.lots.B.lotId) as { total: number }
    ).total;
    if (count !== 1) throw new Error(`Alertes attendues : 1, obtenues : ${count}`);
  });

  check('affectation dans les soldes disponibles : OK', () => {
    const assignment = assignments.createAssignment(ctx.CHEF, {
      lotId: ctx.lots.A.lotId,
      roomId: ctx.rooms[0],
      lineId: firstActiveLine(ctx.rooms[0]),
      sizes: [
        { sizeId: ctx.sizeIds[0], plannedQty: '6' },
        { sizeId: ctx.sizeIds[1], plannedQty: '4' },
      ],
    });
    if (assignment.status !== 'affecte') throw new Error('Statut attendu : affecte.');
  });

  check('refus d’une affectation supérieure au disponible + alerte', () => {
    throwsService(
      () =>
        assignments.createAssignment(ctx.CHEF, {
          lotId: ctx.lots.A.lotId,
          roomId: ctx.rooms[0],
          lineId: firstActiveLine(ctx.rooms[0]),
          sizes: [{ sizeId: ctx.sizeIds[0], plannedQty: '999' }],
        }),
      409,
    );
    const alert = ctx.db
      .prepare(
        `SELECT id FROM alerts WHERE category = 'AFFECTATION_EXCEDENT' AND object_id = ?`,
      )
      .get(ctx.lots.A.lotId);
    if (!alert) throw new Error('Alerte AFFECTATION_EXCEDENT attendue.');
  });

  check('une même pièce ne peut pas être affectée deux fois', () => {
    // 6 déjà affectées en taille 0 sur le lot A (reçu 10) : il reste 4.
    throwsService(
      () =>
        assignments.createAssignment(ctx.CHEF, {
          lotId: ctx.lots.A.lotId,
          roomId: ctx.rooms[0],
          lineId: firstActiveLine(ctx.rooms[0]),
          sizes: [{ sizeId: ctx.sizeIds[0], plannedQty: '5' }],
        }),
      409,
    );
  });

  check('refus d’une ligne désactivée pour une nouvelle affectation', () => {
    const line = ctx.db
      .prepare('SELECT id FROM sewing_lines WHERE room_id = ? AND is_active = 1 LIMIT 1')
      .get(ctx.rooms[1]) as { id: number } | undefined;
    if (line) {
      ctx.db.prepare('UPDATE sewing_lines SET is_active = 0 WHERE id = ?').run(line.id);
      throwsService(
        () =>
          assignments.createAssignment(ctx.CHEF, {
            lotId: ctx.lots.A.lotId,
            roomId: ctx.rooms[1],
            lineId: line.id,
            sizes: [{ sizeId: ctx.sizeIds[0], plannedQty: '3' }],
          }),
        400,
      );
      ctx.db.prepare('UPDATE sewing_lines SET is_active = 1 WHERE id = ?').run(line.id);
    }
  });

  check('transition contrôlée : pause refusée si l’affectation n’est pas en cours', () => {
    const list = assignments.listAssignments(ctx.CHEF, { lotId: String(ctx.lots.A.lotId) });
    throws(() => assignments.patchAssignment(ctx.CHEF, list[0].id, { action: 'pause' }));
  });

  check("démarrage de l'affectation : statuts affectation et lot en cours", () => {
    const list = assignments.listAssignments(ctx.CHEF, { lotId: String(ctx.lots.A.lotId) });
    const updated = assignments.patchAssignment(ctx.CHEF, list[0].id, { action: 'start' });
    if (updated.status !== 'en_cours') throw new Error('Statut attendu : en_cours.');
  });

  check('réaffectation sans motif refusée', () => {
    const list = assignments.listAssignments(ctx.CHEF, { lotId: String(ctx.lots.A.lotId) });
    throwsService(
      () =>
        assignments.patchAssignment(ctx.CHEF, list[0].id, {
          action: 'reassign',
          roomId: ctx.rooms[0],
          lineId: ctx.rooms[0],
        }),
      400,
    );
  });

  check('historique de réception bien enregistré (traçabilité)', () => {
    const rows = ctx.db
      .prepare(
        "SELECT COUNT(*) AS total FROM couture_history WHERE action = 'RECEPTION_CREATED'",
      )
      .get() as { total: number };
    if (rows.total < 1) throw new Error('Historique de réception attendu.');
  });
}
