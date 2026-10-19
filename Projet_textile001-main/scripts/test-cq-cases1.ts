/**
 * Cas de test CQ — partie 1 : réceptions, contrôles, cohérence des
 * quantités. Toutes les règles sont vérifiées par les services serveur.
 */

import type { CoutureTestTools } from './couture-test-utils';
import type { CqTestContext } from './cq-test-context';

export async function runCqCases1(
  ctx: CqTestContext,
  tools: CoutureTestTools,
): Promise<void> {
  const { check, throwsService } = tools;
  const s = await import('../src/server/controle-qualite/receptions');
  const controls = await import('../src/server/controle-qualite/controls');
  const actions = await import('../src/server/controle-qualite/controls-actions');
  const balances = await import('../src/server/controle-qualite/balances');
  const { sizeIds } = ctx;

  check('réception d’un transfert couture confirmé : OK', () => {
    const reception = s.receiveTransfer(ctx.CQ, {
      transferId: ctx.lots.A.transferId,
      lines: sizeIds.map((sizeId) => ({ sizeId, receivedQty: 10 })),
    });
    if (reception.status !== 'complete') {
      throw new Error('La réception complète attend le statut complete.');
    }
  });

  check('refus d’un transfert non confirmé', () => {
    throwsService(
      () =>
        s.receiveTransfer(ctx.CQ, {
          transferId: ctx.lots.B.transferId,
          lines: sizeIds.map((sizeId) => ({ sizeId, receivedQty: 8 })),
        }),
      400,
    );
  });

  check('détection d’une réception en double', () => {
    throwsService(
      () =>
        s.receiveTransfer(ctx.CQ, {
          transferId: ctx.lots.A.transferId,
          lines: sizeIds.map((sizeId) => ({ sizeId, receivedQty: 10 })),
        }),
      409,
    );
    const alert = ctx.db
      .prepare(
        "SELECT COUNT(*) AS n FROM alerts WHERE category = 'DOUBLON_RECEPTION_CQ'",
      )
      .get() as { n: number };
    if (alert.n < 1) throw new Error('Alerte de doublon attendue.');
  });

  check('refus d’une quantité reçue supérieure à la quantité transférée', () => {
    throwsService(
      () =>
        s.receiveTransfer(ctx.CQ, {
          transferId: ctx.lots.D.transferId,
          lines: [
            { sizeId: sizeIds[0], receivedQty: 12 },
            { sizeId: sizeIds[1], receivedQty: 10 },
          ],
        }),
      400,
    );
  });

  check('gestion d’une réception partielle avec alerte d’écart', () => {
    const reception = s.receiveTransfer(ctx.CQ, {
      transferId: ctx.lots.C.transferId,
      lines: [
        { sizeId: sizeIds[0], receivedQty: 4 },
        { sizeId: sizeIds[1], receivedQty: 6 },
      ],
    });
    if (reception.status !== 'partielle') {
      throw new Error('La réception avec écart doit être partielle.');
    }
    const alert = ctx.db
      .prepare(
        "SELECT COUNT(*) AS n FROM alerts WHERE category = 'ECART_RECEPTION_CQ'",
      )
      .get() as { n: number };
    if (alert.n < 1) throw new Error('Alerte d’écart attendue.');
  });

  check('soldes recalculés depuis les mouvements réels', () => {
    const lots = balances.getLotBalances(ctx.CQ);
    const lotA = lots.find((item) => item.lotId === ctx.lots.A.lotId);
    if (!lotA || lotA.totalReceived !== 20) {
      throw new Error(`Solde reçu du lot A inattendu : ${lotA?.totalReceived}`);
    }
    const lotC = lots.find((item) => item.lotId === ctx.lots.C.lotId);
    if (!lotC || lotC.totalReceived !== 10) {
      throw new Error('Solde reçu du lot C inattendu.');
    }
  });

  check('refus de contrôle sur une réception partielle', () => {
    const receptions = s.listReceptions(ctx.CQ);
    const partial = receptions.find(
      (item) => item.transferId === ctx.lots.C.transferId,
    );
    if (!partial) throw new Error('Réception partielle introuvable.');
    throwsService(
      () => controls.createControl(ctx.CQ, { receptionId: partial.id }),
      409,
    );
  });

  check('création du contrôle d’une réception complète', () => {
    const receptions = s.listReceptions(ctx.CQ);
    const complete = receptions.find(
      (item) => item.transferId === ctx.lots.A.transferId,
    );
    const control = controls.createControl(ctx.CQ, { receptionId: complete!.id });
    if (control.status !== 'en_attente' || control.lines.length !== sizeIds.length) {
      throw new Error('Contrôle attendu en attente avec une ligne par taille.');
    }
  });

  check('un seul contrôle par réception', () => {
    const receptions = s.listReceptions(ctx.CQ);
    const complete = receptions.find(
      (item) => item.transferId === ctx.lots.A.transferId,
    );
    throwsService(
      () => controls.createControl(ctx.CQ, { receptionId: complete!.id }),
      409,
    );
  });

  const controlA = () => {
    const list = controls.listControls(ctx.CQ);
    return list.find((item) => item.lotId === ctx.lots.A.lotId)!;
  };

  check('refus de quantités négatives et d’un inspecté supérieur au reçu', () => {
    actions.patchControlStatus(ctx.CQ, controlA().id, { action: 'start' });
    throwsService(
      () =>
        actions.submitResults(ctx.CQ, controlA().id, {
          lines: [{ sizeId: sizeIds[0], inspectedQty: -1, conformeQty: 0 }],
        }),
      400,
    );
    throwsService(
      () =>
        actions.submitResults(ctx.CQ, controlA().id, {
          lines: [{ sizeId: sizeIds[0], inspectedQty: 11, conformeQty: 0 }],
        }),
      409,
    );
  });

  check('impossibilité de déclarer conformes des pièces non inspectées', () => {
    throwsService(
      () =>
        actions.submitResults(ctx.CQ, controlA().id, {
          lines: [
            { sizeId: sizeIds[0], inspectedQty: 5, conformeQty: 6 },
            { sizeId: sizeIds[1], inspectedQty: 0, conformeQty: 0 },
          ],
        }),
      409,
    );
  });

  check('saisie des résultats du contrôle du lot A : OK', () => {
    actions.submitResults(ctx.CQ, controlA().id, {
      lines: sizeIds.map((sizeId) => ({ sizeId, inspectedQty: 10, conformeQty: 9 })),
    });
    const control = controls.getControl(ctx.CQ, controlA().id);
    if (control.status !== 'en_cours') {
      throw new Error('Le contrôle doit passer en cours après saisie.');
    }
  });

  check('validation bloquée tant que des pièces n’ont pas de décision', () => {
    throwsService(
      () => actions.requestValidation(ctx.CQ, controlA().id),
      409,
    );
    const control = controls.getControl(ctx.CQ, controlA().id);
    if (control.status !== 'incomplet') {
      throw new Error('Le contrôle doit passer incomplet.');
    }
  });
}
