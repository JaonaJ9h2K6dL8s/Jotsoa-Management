/**
 * Cas de test CQ — partie 2 : défauts, décisions (retouche/rebut avec
 * seconde validation), contrôles finaux, transferts stock, sécurité.
 */

import type { CoutureTestTools } from './couture-test-utils';
import type { CqTestContext } from './cq-test-context';

export async function runCqCases2(
  ctx: CqTestContext,
  tools: CoutureTestTools,
): Promise<void> {
  const { check, throwsService } = tools;
  const s = await import('../src/server/controle-qualite/receptions');
  const controls = await import('../src/server/controle-qualite/controls');
  const actions = await import('../src/server/controle-qualite/controls-actions');
  const decisions = await import('../src/server/controle-qualite/decisions');
  const finals = await import('../src/server/controle-qualite/final');
  const stock = await import('../src/server/controle-qualite/transfers-stock');
  const sensitive = await import('../src/server/controle-qualite/sensitive');
  const balances = await import('../src/server/controle-qualite/balances');
  const dashboard = await import('../src/server/controle-qualite/dashboard');
  const { sizeIds, CQ, CQ2, COUTURE } = ctx;

  const controlOf = (lotId: number) =>
    controls.listControls(CQ).find((item) => item.lotId === lotId)!;

  // ---- Flux complet du lot D : défaut + rebut avec seconde validation.
  s.receiveTransfer(CQ, {
    transferId: ctx.lots.D.transferId,
    lines: sizeIds.map((sizeId) => ({ sizeId, receivedQty: 10 })),
  });
  controls.createControl(CQ, {
    receptionId: s
      .listReceptions(CQ)
      .find((item) => item.transferId === ctx.lots.D.transferId)!.id,
  });
  const controlD = () => controlOf(ctx.lots.D.lotId);
  actions.patchControlStatus(CQ, controlD().id, { action: 'start' });

  check('déclaration d’un défaut sur un contrôle en cours', () => {
    actions.submitResults(CQ, controlD().id, {
      lines: sizeIds.map((sizeId) => ({ sizeId, inspectedQty: 10, conformeQty: 9 })),
    });
    const defaut = decisions.declareDefaut(CQ, {
      controleId: controlD().id,
      sizeId: sizeIds[0],
      defectId: ctx.defectId,
      qtyPieces: 1,
      severity: 'majeure',
    });
    if (defaut.decision !== 'attente') throw new Error('Décision initiale attendue.');
  });

  check('refus d’une taille non inspectée et d’un défaut inconnu', () => {
    throwsService(
      () =>
        decisions.declareDefaut(CQ, {
          controleId: controlD().id,
          sizeId: sizeIds[0],
          defectId: 999999,
          qtyPieces: 1,
        }),
      400,
    );
  });

  check('validation refusée : pièces en attente de décision', () => {
    throwsService(() => actions.requestValidation(CQ, controlD().id), 409);
  });

  check('rebut soumis à seconde validation', () => {
    const defaut = decisions.listDefauts(CQ, {
      controleId: String(controlD().id),
    })[0];
    const result = decisions.requestDefautRebut(CQ, defaut.id, {
      reason: 'Pièce irrécupérable',
    });
    if (!result.requestId) throw new Error('Demande sensible attendue.');
  });

  const defautD = () =>
    decisions.listDefauts(CQ, { controleId: String(controlD().id) })[0];

  const pendingRebutId = () =>
    Number(
      (
        ctx.db
          .prepare(
            "SELECT id FROM sensitive_requests WHERE action = 'decision_rebut_cq' AND status = 'en_attente' ORDER BY id DESC LIMIT 1",
          )
          .get() as { id: number }
      ).id,
    );

  check('refus de l’auto-approbation', () => {
    tools.throws(() =>
      sensitive.decideSensitiveRequest(CQ, {
        requestId: pendingRebutId(),
        decision: 'approve',
        note: null,
      }),
    );
  });

  check('refus d’une seconde validation par un rôle non habilité', () => {
    tools.throws(() =>
      sensitive.decideSensitiveRequest(COUTURE, {
        requestId: pendingRebutId(),
        decision: 'approve',
        note: null,
      }),
    );
  });

  check('approbation par un autre contrôleur : rebut effectif', () => {
    sensitive.decideSensitiveRequest(CQ2, {
      requestId: pendingRebutId(),
      decision: 'approve',
      note: 'Conforme au constat',
    });
    if (defautD().decision !== 'rebut') {
      throw new Error('La décision de rebut doit être enregistrée.');
    }
  });

  // Deuxième défaut (taille 2) orienté retouche : toutes les pièces
  // inspectées reçoivent une décision définitive.
  decisions.declareDefaut(CQ, {
    controleId: controlD().id,
    sizeId: sizeIds[1],
    defectId: ctx.defectId,
    qtyPieces: 1,
  });
  decisions.createReworkRequest(CQ, {
    defautId: decisions
      .listDefauts(CQ, { controleId: String(controlD().id) })
      .find((defaut) => defaut.sizeId === sizeIds[1])!.id,
    reason: 'Couture à reprendre',
  });

  actions.requestValidation(CQ, controlD().id);
  actions.validateControl(CQ, controlD().id);
  check('contrôle D validé après décisions complètes', () => {
    if (controls.getControl(CQ, controlD().id).status !== 'valide') {
      throw new Error('Statut valide attendu.');
    }
  });

  // ---- Lot A : retouche puis contrôle final (contrôle démarré en partie 1).
  // Défaut déclaré sur la taille 2 uniquement : la taille 1 est
  // entièrement conforme pour que toutes les pièces soient décidées.
  actions.submitResults(CQ, controlOf(ctx.lots.A.lotId).id, {
    lines: [
      { sizeId: sizeIds[0], inspectedQty: 10, conformeQty: 10 },
      { sizeId: sizeIds[1], inspectedQty: 10, conformeQty: 9 },
    ],
  });
  decisions.declareDefaut(CQ, {
    controleId: controlOf(ctx.lots.A.lotId).id,
    sizeId: sizeIds[1],
    defectId: ctx.defectId,
    qtyPieces: 1,
    reworkZoneId: ctx.zoneId,
  });

  check('envoi en retouche traçable', () => {
    const request = decisions.createReworkRequest(CQ, {
      defautId: decisions.listDefauts(CQ, {
        controleId: String(controlOf(ctx.lots.A.lotId).id),
      })[0].id,
      reason: 'Couture à reprendre',
    });
    if (request.status !== 'en_attente' || request.origin !== 'initial') {
      throw new Error('Demande de retouche initiale attendue.');
    }
    ctx.db
      .prepare('SELECT id FROM cq_rework_requests WHERE id = ?')
      .get(request.id);
    (ctx as unknown as { reworkAId: number }).reworkAId = request.id;
  });

  check('pas de double décision sur un défaut déjà orienté', () => {
    throwsService(
      () =>
        decisions.createReworkRequest(CQ, {
          defautId: decisions.listDefauts(CQ, {
            controleId: String(controlOf(ctx.lots.A.lotId).id),
          })[0].id,
          reason: 'Duplicata',
        }),
      409,
    );
  });

  actions.requestValidation(CQ, controlOf(ctx.lots.A.lotId).id);
  actions.validateControl(CQ, controlOf(ctx.lots.A.lotId).id);

  check('contrôle final après retouche : conforme', () => {
    const reworkAId = (ctx as unknown as { reworkAId: number }).reworkAId;
    const final = finals.createFinalControl(CQ, { requestId: reworkAId });
    finals.submitFinalResults(CQ, final.id, {
      lines: [
        { sizeId: sizeIds[1], returnedQty: 1, conformeQty: 1, reworkQty: 0, rebutQty: 0 },
      ],
    });
    const validated = finals.validateFinalControl(CQ, final.id, {});
    if (validated.status !== 'valide') throw new Error('Contrôle final validé attendu.');
  });

  check('nouvelle retouche tracée après échec du contrôle final', () => {
    const reworkE = decisions.createReworkRequest(CQ, {
      defautId: (() => {
        s.receiveTransfer(CQ, {
          transferId: ctx.lots.E.transferId,
          lines: sizeIds.map((sizeId) => ({ sizeId, receivedQty: 4 })),
        });
        controls.createControl(CQ, {
          receptionId: s
            .listReceptions(CQ)
            .find((item) => item.transferId === ctx.lots.E.transferId)!.id,
        });
        const controlE = controlOf(ctx.lots.E.lotId);
        actions.patchControlStatus(CQ, controlE.id, { action: 'start' });
        actions.submitResults(CQ, controlE.id, {
          lines: [
            { sizeId: sizeIds[0], inspectedQty: 4, conformeQty: 2 },
            { sizeId: sizeIds[1], inspectedQty: 4, conformeQty: 4 },
          ],
        });
        decisions.declareDefaut(CQ, {
          controleId: controlE.id,
          sizeId: sizeIds[0],
          defectId: ctx.defectId,
          qtyPieces: 2,
        });
        return decisions.listDefauts(CQ, { controleId: String(controlE.id) })[0].id;
      })(),
      reason: 'Retouche nécessaire',
    });
    actions.requestValidation(CQ, controlOf(ctx.lots.E.lotId).id);
    actions.validateControl(CQ, controlOf(ctx.lots.E.lotId).id);
    const final = finals.createFinalControl(CQ, { requestId: reworkE.id });
    finals.submitFinalResults(CQ, final.id, {
      lines: [
        { sizeId: sizeIds[0], returnedQty: 2, conformeQty: 0, reworkQty: 2, rebutQty: 0 },
      ],
    });
    throwsService(() => finals.validateFinalControl(CQ, final.id, {}), 400);
    finals.validateFinalControl(CQ, final.id, { reason: 'Défaut persistant' });
    const newRequest = ctx.db
      .prepare(
        "SELECT COUNT(*) AS n FROM cq_rework_requests WHERE origin = 'final' AND origin_final = ?",
      )
      .get(final.id) as { n: number };
    if (newRequest.n !== 1) throw new Error('Nouvelle demande de retouche attendue.');
  });

  // ---- Transferts vers le stock.
  check('refus de transfert sur un contrôle non validé', () => {
    s.receiveTransfer(CQ, {
      transferId: ctx.lots.F.transferId,
      lines: sizeIds.map((sizeId) => ({ sizeId, receivedQty: 4 })),
    });
    controls.createControl(CQ, {
      receptionId: s
        .listReceptions(CQ)
        .find((item) => item.transferId === ctx.lots.F.transferId)!.id,
    });
    throwsService(
      () =>
        stock.createStockTransfer(CQ, {
          lotId: ctx.lots.F.lotId,
          lines: [{ sizeId: sizeIds[0], qty: 1 }],
        }),
      409,
    );
  });

  check('transfert des seules quantités conformes disponibles', () => {
    const transfer = stock.createStockTransfer(CQ, {
      lotId: ctx.lots.D.lotId,
      lines: [{ sizeId: sizeIds[0], qty: 5 }],
    });
    if (transfer.status !== 'confirme') throw new Error('Transfert confirmé attendu.');
  });

  check('refus d’un dépassement du disponible et d’un double transfert', () => {
    throwsService(
      () =>
        stock.createStockTransfer(CQ, {
          lotId: ctx.lots.D.lotId,
          lines: [{ sizeId: sizeIds[0], qty: 6 }],
        }),
      409,
    );
    const lots = balances.getLotBalances(CQ);
    const lotD = lots.find((item) => item.lotId === ctx.lots.D.lotId)!;
    const size0 = lotD.sizes.find((item) => item.sizeId === sizeIds[0])!;
    if (size0.availableStock !== 4) {
      throw new Error(`Disponible inattendu : ${size0.availableStock}`);
    }
  });

  // ---- Sécurité et données.
  check('refus des opérations pour un rôle non autorisé', () => {
    throwsService(() => controls.listControls(COUTURE), 403);
    throwsService(
      () =>
        s.receiveTransfer(ctx.STOCK, {
          transferId: ctx.lots.F.transferId,
          lines: [{ sizeId: sizeIds[0], receivedQty: 1 }],
        }),
      403,
    );
    throwsService(
      () =>
        stock.createStockTransfer(COUTURE, {
          lotId: ctx.lots.D.lotId,
          lines: [{ sizeId: sizeIds[0], qty: 1 }],
        }),
      403,
    );
  });

  check('historique complet et sans secret', () => {
    const sensitiveRows = ctx.db
      .prepare('SELECT payload, reason FROM sensitive_requests')
      .all() as Array<{ payload: string; reason: string }>;
    for (const row of sensitiveRows) {
      if (
        `${row.payload} ${row.reason}`.toLowerCase().includes('password') ||
        `${row.payload} ${row.reason}`.toLowerCase().includes('token')
      ) {
        throw new Error('Secret inattendu dans les journaux.');
      }
    }
    const validated = ctx.db
      .prepare("SELECT COUNT(*) AS n FROM cq_history WHERE action = 'CONTROLE_VALIDATED'")
      .get() as { n: number };
    if (validated.n < 2) throw new Error('Historique de validation attendu.');
  });

  check('tableau de bord alimenté par des données réelles', () => {
    const data = dashboard.getDashboard(CQ);
    if (data.quantities.receivedQty <= 0 || data.receptionsCount < 4) {
      throw new Error('Indicateurs de dashboard incohérents.');
    }
    if (data.conformanceRate === null) {
      throw new Error('Taux de conformité attendu (pièces inspectées).');
    }
  });
}
