import { ServiceError } from '@/server/api/service-error';
import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import type { RtRebutProposalDTO } from '@/types/retouche';
import { raiseAlert } from '@/server/alerts/alerts';
import {
  approveSensitiveRequest,
  createSensitiveRequest,
  refuseSensitiveRequest,
} from '@/server/approvals/approvals';
import {
  addHistory,
  nextCode,
  requireCqDecision,
  requireId,
  requireRetouche,
  requireRetoucheOrCq,
  toNumber,
} from './common';

/**
 * Propositions de rebut : lorsqu'une pièce ne peut pas être réparée,
 * le retoucheur propose un rebut. La décision finale appartient au
 * Contrôle qualité (seconde validation obligatoire) ; le retoucheur
 * ne peut jamais transformer une pièce en rebut définitif lui-même.
 */

const PROPOSAL_SELECT = `
  SELECT p.*, r.code AS request_code, s.nom AS size_label,
         ru.nom || ' ' || ru.prenom AS retoucheur_nom,
         du.nom || ' ' || du.prenom AS decided_by_name
  FROM rt_rebut_proposals p
  JOIN cq_rework_requests r ON r.id = p.request_id
  JOIN sizes s ON s.id = p.size_id
  JOIN users ru ON ru.id = p.retoucheur_id
  LEFT JOIN users du ON du.id = p.decided_by`;

function mapProposal(
  row: {
    id: number;
    code: string;
    request_id: number;
    request_code: string;
    size_id: number;
    size_label: string;
    qty: number;
    motif: string;
    retoucheur_nom: string;
    status: 'en_attente' | 'approuvee' | 'refusee';
    decided_by_name: string | null;
    decided_at: string | null;
    decision_note: string | null;
    created_at: string;
  },
): RtRebutProposalDTO {
  return {
    id: row.id,
    code: row.code,
    requestId: row.request_id,
    requestCode: row.request_code,
    sizeId: row.size_id,
    sizeLabel: row.size_label,
    qty: row.qty,
    motif: row.motif,
    retoucheurNom: row.retoucheur_nom,
    status: row.status,
    decidedByName: row.decided_by_name,
    decidedAt: row.decided_at,
    decisionNote: row.decision_note,
    createdAt: row.created_at,
  };
}

export function listRebutProposals(actor: Actor): RtRebutProposalDTO[] {
  requireRetoucheOrCq(actor);
  const db = sessionsDb();
  return (
    db.prepare(`${PROPOSAL_SELECT} ORDER BY p.id DESC`).all() as never[]
  ).map(mapProposal);
}

/** Propose un rebut pour des pièces non réparables d'une demande. */
export function createRebutProposal(
  actor: Actor,
  input: Record<string, unknown>,
): RtRebutProposalDTO {
  requireRetouche(actor);
  const db = sessionsDb();
  const requestId = requireId(input.requestId, 'Demande');
  const sizeId = requireId(input.sizeId, 'Taille');
  const qty = toNumber(input.qty, 'La quantité');
  const motif = String(input.motif ?? '').trim();
  if (qty <= 0) {
    throw new ServiceError('La quantité doit être supérieure à 0.', 400);
  }
  if (!motif) {
    throw new ServiceError('Un motif est obligatoire pour un rebut.', 400);
  }
  const run = db.transaction((): number => {
    const request = db
      .prepare('SELECT id, controle_id, status FROM cq_rework_requests WHERE id = ?')
      .get(requestId) as
      | { id: number; controle_id: number; status: string }
      | undefined;
    if (!request) throw new ServiceError('Demande introuvable.', 404);
    if (request.status !== 'en_attente') {
      throw new ServiceError(
        'Cette demande est déjà transmise au contrôle final ou clôturée.',
        409,
      );
    }
    const irreparable = db
      .prepare(
        `SELECT COALESCE(SUM(il.processed_qty), 0) AS qty
         FROM rt_intervention_lines il
         JOIN rt_interventions i ON i.id = il.intervention_id
         JOIN rt_assignments a ON a.id = i.assignment_id
         WHERE a.request_id = ? AND il.size_id = ?
           AND il.result = 'irreparable' AND i.status = 'terminee'`,
      )
      .get(requestId, sizeId) as { qty: number };
    if (qty > irreparable.qty) {
      throw new ServiceError(
        `La proposition de rebut (${qty}) dépasse les quantités déclarées non réparables (${irreparable.qty}) en taille ${sizeId}.`,
        409,
      );
    }
    const code = nextCode(db, 'rt_rebut_proposals', 'RB-');
    const result = db
      .prepare(
        `INSERT INTO rt_rebut_proposals
           (code, request_id, retoucheur_id, size_id, qty, motif)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(code, requestId, actor.id, sizeId, qty, motif);
    const proposalId = Number(result.lastInsertRowid);
    createSensitiveRequest(db, {
      action: 'decision_rebut_retouche',
      entityType: 'rt_rebut_proposal',
      entityId: proposalId,
      payload: { proposalId, requestId, sizeId, qty },
      reason: motif,
      requestedBy: actor.id,
    });
    addHistory(db, {
      action: 'REBUT_PROPOSE',
      entityType: 'rt_rebut_proposal',
      entityId: proposalId,
      actorId: actor.id,
      newValue: { code, requestId, sizeId, qty },
      reason: motif,
    });
    return proposalId;
  });
  const proposalId = run();
  const row = db
    .prepare(`${PROPOSAL_SELECT} WHERE p.id = ?`)
    .get(proposalId) as never;
  return mapProposal(row);
}

/**
 * Applique une proposition de rebut approuvée : les défauts du
 * contrôle d'origine correspondants passent en décision « rebut ».
 * La cohérence des quantités reste celle du Contrôle qualité.
 */
function applyRebutApproval(
  db: ReturnType<typeof sessionsDb>,
  actor: Actor,
  payload: unknown,
): void {
  const data = payload as { proposalId: number; requestId: number; sizeId: number };
  const proposal = db
    .prepare('SELECT id, status FROM rt_rebut_proposals WHERE id = ?')
    .get(data.proposalId) as { id: number; status: string } | undefined;
  if (!proposal || proposal.status !== 'en_attente') {
    throw new ServiceError('Proposition de rebut introuvable ou déjà traitée.', 409);
  }
  db.prepare(
    `UPDATE rt_rebut_proposals
     SET status = 'approuvee', decided_by = ?, decided_at = datetime('now'), decision_note = ?
     WHERE id = ?`,
  ).run(actor.id, 'Rebut approuvé par le Contrôle qualité.', proposal.id);
  const request = db
    .prepare('SELECT controle_id FROM cq_rework_requests WHERE id = ?')
    .get(data.requestId) as { controle_id: number } | undefined;
  if (request) {
    db.prepare(
      `UPDATE cq_defauts SET decision = 'rebut'
       WHERE controle_id = ? AND size_id = ? AND decision = 'retouche'`,
    ).run(request.controle_id, data.sizeId);
  }
  addHistory(db, {
    action: 'REBUT_APPROUVE',
    entityType: 'rt_rebut_proposal',
    entityId: proposal.id,
    actorId: actor.id,
    oldValue: { status: 'en_attente' },
    newValue: { status: 'approuvee' },
  });
}

/** Le Contrôle qualité approuve ou refuse une proposition de rebut. */
export function decideRebutProposal(
  actor: Actor,
  input: Record<string, unknown>,
): void {
  requireCqDecision(actor);
  const db = sessionsDb();
  const proposalId = requireId(input.proposalId, 'Proposition');
  const decision = String(input.decision ?? '');
  const note = typeof input.note === 'string' ? input.note : '';
  const proposal = db
    .prepare('SELECT id, code, request_id FROM rt_rebut_proposals WHERE id = ?')
    .get(proposalId) as
    | { id: number; code: string; request_id: number }
    | undefined;
  if (!proposal) throw new ServiceError('Proposition introuvable.', 404);
  const pending = db
    .prepare(
      `SELECT id FROM sensitive_requests
       WHERE action = 'decision_rebut_retouche' AND entity_id = ? AND status = 'en_attente'`,
    )
    .get(proposalId) as { id: number } | undefined;
  if (!pending) {
    throw new ServiceError('Aucune seconde validation en attente pour cette proposition.', 409);
  }
  if (decision === 'approve') {
    // Seul le Contrôle qualité décide ; l'auteur ne peut pas s'auto-approuver
    // (règle imposée par le mécanisme central).
    approveSensitiveRequest(db, {
      requestId: pending.id,
      approver: { id: actor.id, roleCode: actor.roleCode },
      allowedRoles: ['controleur_qualite'],
      note: note.trim() || null,
      apply: (payload) => applyRebutApproval(db, actor, payload),
    });
    raiseAlert(db, {
      category: 'REBUT_RT_APPROUVE',
      severity: 'info',
      objectType: 'rt_rebut_proposal',
      objectId: proposalId,
      message: `Proposition de rebut ${proposal.code} approuvée par le Contrôle qualité.`,
      ownerRole: 'retoucheur',
    });
  } else if (decision === 'refuse') {
    refuseSensitiveRequest(db, {
      requestId: pending.id,
      approver: { id: actor.id, roleCode: actor.roleCode },
      allowedRoles: ['controleur_qualite'],
      note,
    });
    db.prepare(
      `UPDATE rt_rebut_proposals
       SET status = 'refusee', decided_by = ?, decided_at = datetime('now'), decision_note = ?
       WHERE id = ?`,
    ).run(actor.id, note.trim() || null, proposalId);
    raiseAlert(db, {
      category: 'REBUT_RT_REFUSE',
      severity: 'warning',
      objectType: 'rt_rebut_proposal',
      objectId: proposalId,
      message: `Proposition de rebut ${proposal.code} refusée par le Contrôle qualité.`,
      ownerRole: 'retoucheur',
    });
    addHistory(db, {
      action: 'REBUT_REFUSE',
      entityType: 'rt_rebut_proposal',
      entityId: proposalId,
      actorId: actor.id,
      oldValue: { status: 'en_attente' },
      newValue: { status: 'refusee' },
    });
  } else {
    throw new ServiceError('Décision inconnue : approuver ou refuser.', 400);
  }
}
