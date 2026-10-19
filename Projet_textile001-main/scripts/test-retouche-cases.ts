/**
 * Cas de test du module Retouche — réceptions, affectations,
 * interventions, retours CQ, rebuts, sécurité et historique.
 */

import type Database from 'better-sqlite3';
import type { CoutureTestTools } from './couture-test-utils';

interface ActorLike {
  id: number;
  roleCode: string;
}

interface RtContext {
  db: Database.Database;
  tools: CoutureTestTools;
  RT: ActorLike;
  RT2: ActorLike;
  CQ: ActorLike;
  request0Id: number;
  request1Id: number;
  sizeIds: number[];
}

export async function runRetoucheCases(ctx: RtContext): Promise<void> {
  const { check, throwsService } = ctx.tools;
  const requests = await import('../src/server/retouche/requests');
  const assignments = await import('../src/server/retouche/assignments');
  const interventions = await import('../src/server/retouche/interventions');
  const returns = await import('../src/server/retouche/returns');
  const rebut = await import('../src/server/retouche/rebut');
  const dashboard = await import('../src/server/retouche/dashboard');
  const cqControls = await import('../src/server/controle-qualite/controls');
  const { RT, RT2, CQ, sizeIds } = ctx;

  check('les demandes proviennent des décisions réelles du CQ', () => {
    const list = requests.listRequests(RT as never);
    if (!list.some((item) => item.id === ctx.request0Id)) {
      throw new Error('Demande 0 introuvable dans la liste retouche.');
    }
    if (!list.some((item) => item.id === ctx.request1Id)) {
      throw new Error('Demande 1 introuvable dans la liste retouche.');
    }
  });

  check('refus d’une quantité reçue supérieure à la demande', () => {
    throwsService(
      () =>
        requests.receiveRequest(RT as never, ctx.request0Id, {
          lines: [{ sizeId: sizeIds[0], receivedQty: 3 }],
        }),
      409,
    );
  });

  check('réception avec écart : alerte et quantités distinctes', () => {
    const request = requests.receiveRequest(RT as never, ctx.request0Id, {
      lines: [{ sizeId: sizeIds[0], receivedQty: 1 }],
    });
    if (request.lines[0].receivedQty !== 1 || request.lines[0].requestedQty !== 2) {
      throw new Error('Quantités reçue/demandée incohérentes.');
    }
    const alert = ctx.db
      .prepare(
        "SELECT COUNT(*) AS n FROM alerts WHERE category = 'ECART_RECEPTION_RT'",
      )
      .get() as { n: number };
    if (alert.n < 1) throw new Error('Alerte d’écart attendue.');
  });

  check('détection d’une réception en double', () => {
    throwsService(
      () =>
        requests.receiveRequest(RT as never, ctx.request0Id, {
          lines: [{ sizeId: sizeIds[0], receivedQty: 1 }],
        }),
      409,
    );
    const alert = ctx.db
      .prepare(
        "SELECT COUNT(*) AS n FROM alerts WHERE category = 'DOUBLON_RECEPTION_RT'",
      )
      .get() as { n: number };
    if (alert.n < 1) throw new Error('Alerte de doublon attendue.');
  });

  check('réception complète de la seconde demande', () => {
    requests.receiveRequest(RT as never, ctx.request1Id, {
      lines: [{ sizeId: sizeIds[1], receivedQty: 1 }],
    });
  });

  check('refus d’affectation d’un utilisateur non retoucheur', () => {
    throwsService(
      () =>
        assignments.createAssignment(RT as never, {
          requestId: ctx.request0Id,
          retoucheurId: CQ.id,
          lines: [{ sizeId: sizeIds[0], qty: 1 }],
        }),
      400,
    );
  });

  check('refus d’une affectation supérieure au disponible', () => {
    throwsService(
      () =>
        assignments.createAssignment(RT as never, {
          requestId: ctx.request0Id,
          retoucheurId: RT.id,
          lines: [{ sizeId: sizeIds[0], qty: 2 }],
        }),
      409,
    );
    const alert = ctx.db
      .prepare(
        "SELECT COUNT(*) AS n FROM alerts WHERE category = 'AFFECTATION_EXCEDENT_RT'",
      )
      .get() as { n: number };
    if (alert.n < 1) throw new Error('Alerte d’excédent attendue.');
  });

  check('affectation d’une quantité disponible : OK', () => {
    const assignment = assignments.createAssignment(RT as never, {
      requestId: ctx.request0Id,
      retoucheurId: RT.id,
      lines: [{ sizeId: sizeIds[0], qty: 1 }],
    });
    if (assignment.status !== 'affectee') {
      throw new Error('Affectation attendue avec statut affectee.');
    }
    (ctx as unknown as { assignment0Id: number }).assignment0Id = assignment.id;
  });

  check('refus de la double affectation de la même quantité', () => {
    throwsService(
      () =>
        assignments.createAssignment(RT as never, {
          requestId: ctx.request0Id,
          retoucheurId: RT2.id,
          lines: [{ sizeId: sizeIds[0], qty: 1 }],
        }),
      409,
    );
  });

  const assignment0Id = () =>
    (ctx as unknown as { assignment0Id: number }).assignment0Id;

  check('seul le retoucheur affecté peut démarrer l’intervention', () => {
    throwsService(
      () =>
        interventions.startIntervention(RT2 as never, {
          assignmentId: assignment0Id(),
        }),
      403,
    );
  });

  check('démarrage de l’intervention par le retoucheur affecté', () => {
    const intervention = interventions.startIntervention(RT as never, {
      assignmentId: assignment0Id(),
      action: 'Reprise de la couture latérale',
    });
    if (intervention.status !== 'en_cours') {
      throw new Error('Intervention attendue en cours.');
    }
    (ctx as unknown as { intervention0Id: number }).intervention0Id =
      intervention.id;
  });

  const intervention0Id = () =>
    (ctx as unknown as { intervention0Id: number }).intervention0Id;

  check('refus d’un cumul traité supérieur à la quantité affectée', () => {
    throwsService(
      () =>
        interventions.finishIntervention(RT as never, intervention0Id(), {
          lines: [{ sizeId: sizeIds[0], processedQty: 2, result: 'repare' }],
        }),
      409,
    );
  });

  check('fin d’intervention avec résultat', () => {
    const intervention = interventions.finishIntervention(
      RT as never,
      intervention0Id(),
      {
        notes: 'Couture reprise',
        lines: [{ sizeId: sizeIds[0], processedQty: 1, result: 'repare' }],
      },
    );
    if (intervention.status !== 'terminee' || !intervention.endedAt) {
      throw new Error('Intervention terminée attendue avec horodatage.');
    }
  });

  // Demande 1 : intervention non réparable.
  assignments.createAssignment(RT as never, {
    requestId: ctx.request1Id,
    retoucheurId: RT2.id,
    lines: [{ sizeId: sizeIds[1], qty: 1 }],
  });
  const intervention1 = interventions.startIntervention(RT2 as never, {
    assignmentId: assignments.listAssignments(RT as never)[0].id,
  });
  interventions.finishIntervention(RT2 as never, intervention1.id, {
    lines: [{ sizeId: sizeIds[1], processedQty: 1, result: 'irreparable' }],
  });

  check('refus de retour supérieur aux réparations disponibles', () => {
    throwsService(
      () =>
        returns.createReturn(RT as never, {
          requestId: ctx.request0Id,
          lines: [{ sizeId: sizeIds[0], qty: 2 }],
        }),
      409,
    );
    const alert = ctx.db
      .prepare(
        "SELECT COUNT(*) AS n FROM alerts WHERE category = 'RETOUR_EXCEDENT_RT'",
      )
      .get() as { n: number };
    if (alert.n < 1) throw new Error('Alerte d’excédent de retour attendue.');
  });

  check('retour au CQ des quantités réparées : OK puis refus du double', () => {
    returns.createReturn(RT as never, {
      requestId: ctx.request0Id,
      lines: [{ sizeId: sizeIds[0], qty: 1 }],
    });
    throwsService(
      () =>
        returns.createReturn(RT as never, {
          requestId: ctx.request0Id,
          lines: [{ sizeId: sizeIds[0], qty: 1 }],
        }),
      409,
    );
  });

  check('refus d’une proposition de rebut supérieure au non réparable', () => {
    throwsService(
      () =>
        rebut.createRebutProposal(RT2 as never, {
          requestId: ctx.request1Id,
          sizeId: sizeIds[1],
          qty: 2,
          motif: 'Test excédent',
        }),
      409,
    );
  });

  check('proposition de rebut soumise à seconde validation', () => {
    const proposal = rebut.createRebutProposal(RT2 as never, {
      requestId: ctx.request1Id,
      sizeId: sizeIds[1],
      qty: 1,
      motif: 'Tissu irrécupérable',
    });
    if (proposal.status !== 'en_attente') {
      throw new Error('Proposition attendue en attente.');
    }
    (ctx as unknown as { proposalId: number }).proposalId = proposal.id;
  });

  const proposalId = () =>
    (ctx as unknown as { proposalId: number }).proposalId;

  check('refus de l’auto-approbation et d’un rôle non habilité', () => {
    // Le mécanisme central des validations lève une erreur générique
    // (non ServiceError) : même convention que les tests CQ.
    ctx.tools.throws(() =>
      rebut.decideRebutProposal(RT2 as never, {
        proposalId: proposalId(),
        decision: 'approve',
        note: null,
      }),
    );
    ctx.tools.throws(() =>
      rebut.decideRebutProposal(RT as never, {
        proposalId: proposalId(),
        decision: 'approve',
        note: null,
      }),
    );
  });

  check('approbation par le CQ : rebut effectif et traçable', () => {
    rebut.decideRebutProposal(CQ as never, {
      proposalId: proposalId(),
      decision: 'approve',
      note: 'Conforme au constat',
    });
    const proposals = rebut.listRebutProposals(RT as never);
    const approved = proposals.find((item) => item.id === proposalId())!;
    if (approved.status !== 'approuvee' || !approved.decidedByName) {
      throw new Error('Proposition approuvée attendue.');
    }
    const defaut = ctx.db
      .prepare(
        `SELECT decision FROM cq_defauts WHERE id = (SELECT defaut_id FROM (
           SELECT id AS defaut_id FROM cq_defauts ORDER BY id DESC LIMIT 1))`,
      )
      .get() as { decision: string };
    if (defaut.decision !== 'rebut') {
      throw new Error('Le défaut doit passer en décision rebut.');
    }
  });

  check('isolation des rôles des deux côtés', () => {
    throwsService(() => cqControls.listControls(RT as never), 403);
    throwsService(
      () => requests.listRequests(CQ as never),
      403,
    );
  });

  check('historique complet du module sans secret', () => {
    const actions = ctx.db
      .prepare('SELECT DISTINCT action FROM rt_history')
      .all() as Array<{ action: string }>;
    const names = actions.map((row) => row.action);
    for (const expected of [
      'DEMANDE_RECUE',
      'AFFECTATION_CREEE',
      'INTERVENTION_DEMARREE',
      'INTERVENTION_TERMINEE',
      'RETOUR_CONTROLE_QUALITE',
      'REBUT_PROPOSE',
      'REBUT_APPROUVE',
    ]) {
      if (!names.includes(expected)) {
        throw new Error(`Action historisée attendue : ${expected}`);
      }
    }
    const rows = ctx.db
      .prepare('SELECT old_value, new_value, reason FROM rt_history')
      .all() as Array<{ old_value: string | null; new_value: string | null; reason: string | null }>;
    for (const row of rows) {
      const text = `${row.old_value ?? ''} ${row.new_value ?? ''} ${row.reason ?? ''}`.toLowerCase();
      if (text.includes('password') || text.includes('token')) {
        throw new Error('Secret inattendu dans l’historique.');
      }
    }
  });

  check('tableau de bord alimenté par des données réelles', () => {
    const data = dashboard.getDashboard(RT as never);
    if (data.requestsCount < 2 || data.quantities.processedQty < 2) {
      throw new Error('Indicateurs de dashboard incohérents.');
    }
    if (data.quantities.returnedQty !== 1 || data.quantities.irreparableQty !== 1) {
      throw new Error('Soldes de retour / non réparable incohérents.');
    }
    if (data.pendingRebutProposals !== 0) {
      throw new Error('Aucune proposition en attente attendue après approbation.');
    }
  });
}
