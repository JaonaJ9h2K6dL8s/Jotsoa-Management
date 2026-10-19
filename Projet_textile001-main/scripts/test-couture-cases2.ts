/**
 * Cas de test Couture — partie 2 : production, transferts CQ,
 * incidents, sécurité et secondes validations.
 */

import type { CoutureTestTools } from './couture-test-utils';
import type { CoutureTestContext } from './test-couture-cases1';

interface CoutureModules2 {
  assignments: typeof import('../src/server/couture/assignments');
  balances: typeof import('../src/server/couture/balances');
  productions: typeof import('../src/server/couture/productions');
  transfers: typeof import('../src/server/couture/transfers-cq');
  incidents: typeof import('../src/server/couture/incidents');
  sensitive: typeof import('../src/server/couture/sensitive');
  lines: typeof import('../src/server/couture/lines');
  dashboard: typeof import('../src/server/couture/dashboard');
  history: typeof import('../src/server/couture/history');
}

export async function runCoutureCases2(
  ctx: CoutureTestContext,
  tools: CoutureTestTools,
): Promise<void> {
  const { check, throwsService, throws } = tools;
  const m: CoutureModules2 = {
    assignments: await import('../src/server/couture/assignments'),
    balances: await import('../src/server/couture/balances'),
    productions: await import('../src/server/couture/productions'),
    transfers: await import('../src/server/couture/transfers-cq'),
    incidents: await import('../src/server/couture/incidents'),
    sensitive: await import('../src/server/couture/sensitive'),
    lines: await import('../src/server/couture/lines'),
    dashboard: await import('../src/server/couture/dashboard'),
    history: await import('../src/server/couture/history'),
  };

  // Lot D : réception puis affectation dédiée pour la partie production.
  const receptions = await import('../src/server/couture/receptions');
  receptions.receiveTransfer(ctx.CHEF, {
    transferId: ctx.lots.D.transferId,
    lines: [
      { sizeId: ctx.sizeIds[0], receivedQty: '6' },
      { sizeId: ctx.sizeIds[1], receivedQty: '6' },
    ],
  });
  const firstActiveLine = (roomId: number): number =>
    (
      ctx.db
        .prepare('SELECT id FROM sewing_lines WHERE room_id = ? AND is_active = 1 LIMIT 1')
        .get(roomId) as { id: number } | undefined
    )?.id ?? 0;
  const assignmentD = m.assignments.createAssignment(ctx.CHEF, {
    lotId: ctx.lots.D.lotId,
    roomId: ctx.rooms[0],
    lineId: firstActiveLine(ctx.rooms[0]),
    sizes: [
      { sizeId: ctx.sizeIds[0], plannedQty: '4' },
      { sizeId: ctx.sizeIds[1], plannedQty: '2' },
    ],
  });

  check("refus de transfert d'une quantité seulement prévue (non cousue)", () => {
    throwsService(
      () =>
        m.transfers.createTransfer(ctx.CHEF, {
          assignmentId: assignmentD.id,
          sizes: [{ sizeId: ctx.sizeIds[0], qty: '2' }],
        }),
      409,
    );
  });

  check('enregistrement de production : OK, affectation passée en cours', () => {
    const production = m.productions.recordProduction(ctx.CHEF, {
      assignmentId: assignmentD.id,
      sizeId: ctx.sizeIds[0],
      qty: '3',
    });
    if (production.status !== 'normal') throw new Error('Production attendue active.');
  });

  check('plusieurs enregistrements pour une même affectation : OK', () => {
    m.productions.recordProduction(ctx.CHEF, {
      assignmentId: assignmentD.id,
      sizeId: ctx.sizeIds[0],
      qty: '1',
    });
  });

  check('refus d’une production dépassant la quantité prévue + alerte', () => {
    // 3 + 1 déjà cousues sur un prévu de 4.
    throwsService(
      () =>
        m.productions.recordProduction(ctx.CHEF, {
          assignmentId: assignmentD.id,
          sizeId: ctx.sizeIds[0],
          qty: '1',
        }),
      409,
    );
    const alert = ctx.db
      .prepare(
        `SELECT id FROM alerts WHERE category = 'PRODUCTION_EXCEDENT' AND object_id = ?`,
      )
      .get(assignmentD.id);
    if (!alert) throw new Error('Alerte PRODUCTION_EXCEDENT attendue.');
  });

  check('refus d’une taille hors affectation', () => {
    throwsService(
      () =>
        m.productions.recordProduction(ctx.CHEF, {
          assignmentId: assignmentD.id,
          sizeId: ctx.sizeIds[0] + 999,
          qty: '1',
        }),
      400,
    );
  });

  check('refus d’une quantité négative', () => {
    throwsService(
      () =>
        m.productions.recordProduction(ctx.CHEF, {
          assignmentId: assignmentD.id,
          sizeId: ctx.sizeIds[1],
          qty: '-2',
        }),
      400,
    );
  });

  check('pas de double comptage : soldes cohérents (cousu = 4)', () => {
    const balance = m.balances
      .getLotBalances(ctx.CHEF)
      .find((lot) => lot.lotId === ctx.lots.D.lotId);
    if (!balance || balance.sewnQty !== 4) {
      throw new Error(`Cousu attendu 4, obtenu ${balance?.sewnQty}`);
    }
  });

  check('transfert d’une quantité cousue et disponible : OK', () => {
    const transfer = m.transfers.createTransfer(ctx.CHEF, {
      assignmentId: assignmentD.id,
      sizes: [{ sizeId: ctx.sizeIds[0], qty: '1' }],
    });
    if (transfer.status !== 'confirme') throw new Error('Transfert attendu confirmé.');
  });

  check('refus d’un double transfert au-delà du disponible', () => {
    throwsService(
      () =>
        m.transfers.createTransfer(ctx.CHEF, {
          assignmentId: assignmentD.id,
          sizes: [{ sizeId: ctx.sizeIds[0], qty: '999' }],
        }),
      409,
    );
  });

  check('transfert partiel autorisé dans les limites du disponible', () => {
    // Reste 3 cousues non transférées en taille 0.
    m.transfers.createTransfer(ctx.CHEF, {
      assignmentId: assignmentD.id,
      sizes: [{ sizeId: ctx.sizeIds[0], qty: '2' }],
    });
  });

  check('correction de production : demande sensible, pas d’écriture directe', () => {
    const productions = m.productions.listProductions(ctx.CHEF, {
      assignmentId: String(assignmentD.id),
    });
    const target = productions.find((item) => item.qty === 3 && item.status === 'normal');
    if (!target) throw new Error('Production cible introuvable.');
    const { requestId } = m.productions.requestProductionCorrection(ctx.CHEF, target.id, {
      newQty: '2',
      reason: 'Erreur de saisie de la première passe.',
    });
    const request = ctx.db
      .prepare('SELECT status FROM sensitive_requests WHERE id = ?')
      .get(requestId) as { status: string };
    if (request.status !== 'en_attente') throw new Error('Demande attendue en attente.');
  });

  check('auto-approbation refusée', () => {
    const pending = ctx.db
      .prepare(`SELECT id FROM sensitive_requests WHERE status = 'en_attente'`)
      .get() as { id: number };
    throws(() =>
      m.sensitive.decideSensitiveRequest(ctx.CHEF, {
        requestId: pending.id,
        decision: 'approve',
        note: '',
      }),
    );
  });

  check('validation par un rôle non habilité refusée', () => {
    const pending = ctx.db
      .prepare(`SELECT id FROM sensitive_requests WHERE status = 'en_attente'`)
      .get() as { id: number };
    throws(() =>
      m.sensitive.decideSensitiveRequest(
        { id: ctx.STOCK.id, roleCode: 'chef_stock' },
        { requestId: pending.id, decision: 'approve', note: '' },
      ),
    );
  });

  check('approbation par un second chef_couture : correction appliquée', () => {
    const pending = ctx.db
      .prepare(`SELECT id FROM sensitive_requests WHERE status = 'en_attente'`)
      .get() as { id: number };
    m.sensitive.decideSensitiveRequest(
      { id: ctx.CHEF2.id, roleCode: 'chef_couture' },
      { requestId: pending.id, decision: 'approve', note: 'Vérifié avec la ligne.' },
    );
    const productions = m.productions.listProductions(ctx.CHEF, {
      assignmentId: String(assignmentD.id),
    });
    const corrected = productions.find((item) => item.status === 'corrigee');
    if (!corrected) throw new Error('Ancienne production marquée corrigée attendue.');
  });

  check('seconde validation refusée : commentaire obligatoire', () => {
    const productions = m.productions.listProductions(ctx.CHEF, {
      assignmentId: String(assignmentD.id),
    });
    const target = productions.find((item) => item.qty === 1 && item.status === 'normal');
    if (!target) throw new Error('Production cible introuvable.');
    const { requestId } = m.productions.requestProductionCancel(ctx.CHEF, target.id, {
      reason: 'Pièce comptée deux fois.',
    });
    throws(() =>
      m.sensitive.decideSensitiveRequest(
        { id: ctx.CHEF2.id, roleCode: 'chef_couture' },
        { requestId, decision: 'refuse', note: '' },
      ),
    );
  });

  check('annulation de transfert via seconde validation : soldes recalculés', () => {
    const transfers = m.transfers.listTransfers(ctx.CHEF);
    const target = transfers.find(
      (item) => item.assignmentId === assignmentD.id && item.status === 'confirme',
    );
    if (!target) throw new Error('Transfert confirmé introuvable.');
    const { requestId } = m.transfers.requestTransferCancel(ctx.CHEF, target.id, {
      reason: 'Erreur de ligne : mauvaise affectation.',
    });
    m.sensitive.decideSensitiveRequest(
      { id: ctx.CHEF2.id, roleCode: 'chef_couture' },
      { requestId, decision: 'approve', note: 'Annulation justifiée.' },
    );
    const cancelled = ctx.db
      .prepare('SELECT status FROM couture_transfers WHERE id = ?')
      .get(target.id) as { status: string };
    if (cancelled.status !== 'annule') throw new Error('Transfert attendu annulé.');
  });

  check('annulation de transfert sans motif refusée', () => {
    const transfers = m.transfers.listTransfers(ctx.CHEF);
    const target = transfers.find((item) => item.status === 'confirme');
    if (target) {
      throwsService(
        () => m.transfers.requestTransferCancel(ctx.CHEF, target.id, { reason: '' }),
        400,
      );
    }
  });

  check('rôle non autorisé : lecture et écriture refusées (403)', () => {
    throwsService(() => m.productions.listProductions(ctx.STOCK, {}), 403);
    throwsService(
      () =>
        m.productions.recordProduction(ctx.STOCK, {
          assignmentId: assignmentD.id,
          sizeId: ctx.sizeIds[0],
          qty: '1',
        }),
      403,
    );
    throwsService(() => m.transfers.listTransfers(ctx.STOCK), 403);
    throwsService(() => m.sensitive.listSensitiveRequests(ctx.STOCK), 403);
  });

  check('incident critique : blocage automatique de l’affectation + alerte', () => {
    const incident = m.incidents.createIncident(ctx.CHEF, {
      assignmentId: assignmentD.id,
      incidentType: 'machine_panne',
      severity: 'critique',
      description: 'Machine à coudre n°3 en panne majeure.',
    });
    const assignment = ctx.db
      .prepare('SELECT status FROM couture_assignments WHERE id = ?')
      .get(assignmentD.id) as { status: string };
    if (assignment.status !== 'bloquee') {
      throw new Error(`Affectation attendue bloquee, obtenue ${assignment.status}`);
    }
    const alert = ctx.db
      .prepare(`SELECT id FROM alerts WHERE category = 'INCIDENT_CRITIQUE' AND object_id = ?`)
      .get(incident.id);
    if (!alert) throw new Error('Alerte INCIDENT_CRITIQUE attendue.');
  });

  check('résolution d’incident sans commentaire refusée', () => {
    const incidents = m.incidents.listIncidents(ctx.CHEF, { status: 'ouverte' });
    const target = incidents[0];
    throwsService(
      () => m.incidents.patchIncident(ctx.CHEF, target.id, { action: 'resolve', note: '' }),
      400,
    );
  });

  check('résolution d’incident avec commentaire : OK puis clôture', () => {
    const incidents = m.incidents.listIncidents(ctx.CHEF, { status: 'ouverte' });
    const target = incidents[0];
    m.incidents.patchIncident(ctx.CHEF, target.id, {
      action: 'resolve',
      note: 'Machine réparée par le technicien.',
    });
    m.incidents.patchIncident(ctx.CHEF, target.id, { action: 'close' });
    const row = ctx.db
      .prepare('SELECT status FROM couture_incidents WHERE id = ?')
      .get(target.id) as { status: string };
    if (row.status !== 'cloturee') throw new Error('Incident attendu clôturé.');
  });

  check('désactivation d’une ligne occupée refusée', () => {
    const lineId = (
      ctx.db
        .prepare('SELECT line_id FROM couture_assignments WHERE id = ?')
        .get(assignmentD.id) as { line_id: number }
    ).line_id;
    throwsService(
      () => m.lines.patchLine(ctx.CHEF, lineId, { action: 'deactivate' }),
      409,
    );
  });

  check('tableau de bord : compteurs issus des données réelles', () => {
    const data = m.dashboard.getDashboard(ctx.CHEF);
    if (data.quantities.sewnQty <= 0) throw new Error('Production cousue attendue.');
    if (data.quantities.transferredCqQty < 0) throw new Error('Incohérence transferts CQ.');
    if (data.openIncidents < 0 || data.openAlerts < 0) {
      throw new Error('Compteurs invalides.');
    }
  });

  check('historique : corrections et validations tracées', () => {
    const actions = m.history
      .listHistory(ctx.CHEF, {})
      .map((entry) => entry.action);
    for (const expected of [
      'PRODUCTION_RECORDED',
      'PRODUCTION_CORRECTION_REQUESTED',
      'SENSITIVE_APPROVED',
      'TRANSFER_CQ_CONFIRMED',
      'TRANSFER_CQ_CANCELLED',
      'INCIDENT_RESOLVE',
    ]) {
      if (!actions.includes(expected)) {
        throw new Error(`Action ${expected} absente de l’historique.`);
      }
    }
  });

  check('aucun secret dans les journaux d’alertes', () => {
    const alerts = ctx.db.prepare('SELECT message FROM alerts').all() as Array<{
      message: string;
    }>;
    for (const alert of alerts) {
      if (/password|token|hash/i.test(alert.message)) {
        throw new Error('Secret potentiel dans une alerte.');
      }
    }
  });

  check('intégrité SQLite après toutes les opérations', () => {
    const result = ctx.db.pragma('integrity_check') as Array<{
      integrity_check: string;
    }>;
    if (result[0]?.integrity_check !== 'ok') {
      throw new Error('Intégrité SQLite compromise.');
    }
  });
}
