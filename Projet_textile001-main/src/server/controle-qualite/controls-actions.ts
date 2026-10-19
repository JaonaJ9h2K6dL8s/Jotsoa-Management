import { ServiceError } from '@/server/api/service-error';
import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import type { CqControlDTO } from '@/types/cq';
import { raiseAlert } from '@/server/alerts/alerts';
import {
  addHistory,
  normalizeText,
  requireCq,
  requireId,
  toNumber,
} from './common';
import {
  checkControlCoherence,
  decidedDefauts,
  getControl,
} from './controls';

/**
 * Transitions et saisie des résultats d'un contrôle : démarrage,
 * enregistrement des quantités inspectées/conformes par taille,
 * demande de validation, validation, blocage, clôture.
 * La modification directe d'un contrôle validé est interdite : la
 * réouverture passe par une seconde validation.
 */

interface ControlBasic {
  id: number;
  code: string;
  reception_id: number;
  lot_id: number;
  status: string;
}

function requireControl(
  db: ReturnType<typeof sessionsDb>,
  controleId: number,
): ControlBasic {
  const row = db
    .prepare('SELECT id, code, reception_id, lot_id, status FROM cq_controles WHERE id = ?')
    .get(controleId) as ControlBasic | undefined;
  if (!row) throw new ServiceError('Contrôle introuvable.', 404);
  return row;
}

/** Enregistre les quantités inspectées et conformes par taille. */
export function submitResults(
  actor: Actor,
  rawId: unknown,
  input: Record<string, unknown>,
): void {
  requireCq(actor);
  const db = sessionsDb();
  const controleId = requireId(rawId, 'Contrôle');
  const rawLines = Array.isArray(input.lines) ? input.lines : [];
  if (rawLines.length === 0) {
    throw new ServiceError('Aucune quantité fournie.', 400);
  }
  const update = db.transaction(() => {
    const control = requireControl(db, controleId);
    if (!['en_attente', 'en_cours', 'incomplet'].includes(control.status)) {
      throw new ServiceError(
        'Ce contrôle n’accepte plus de saisie (validé, clôturé ou bloqué).',
        409,
      );
    }
    for (const entry of rawLines) {
      const record = entry as Record<string, unknown>;
      const sizeId = requireId(record.sizeId, 'Taille');
      const inspected = toNumber(record.inspectedQty, 'La quantité inspectée');
      const conforme = toNumber(record.conformeQty, 'La quantité conforme');
      if (inspected < 0 || conforme < 0) {
        throw new ServiceError('Les quantités ne peuvent pas être négatives.', 400);
      }
      const line = db
        .prepare(
          `SELECT received_qty FROM cq_reception_lines
           WHERE reception_id = ? AND size_id = ?`,
        )
        .get(control.reception_id, sizeId) as
        | { received_qty: number }
        | undefined;
      if (!line) {
        throw new ServiceError(
          'Cette taille ne fait pas partie de la réception d’origine.',
          400,
        );
      }
      if (inspected > line.received_qty) {
        raiseAlert(db, {
          category: 'CONTROLE_EXCEDENT_CQ',
          severity: 'warning',
          objectType: 'cq_controle',
          objectId: controleId,
          message: `Saisie de ${inspected} pièce(s) inspectée(s) en taille ${sizeId} alors que la réception porte sur ${line.received_qty}.`,
          ownerRole: 'controleur_qualite',
        });
        throw new ServiceError(
          `Quantité inspectée supérieure à la quantité reçue en taille ${sizeId}.`,
          409,
        );
      }
      const decided = decidedDefauts(db, controleId, sizeId);
      if (conforme + decided.rework + decided.rebut > inspected) {
        throw new ServiceError(
          `Les décisions déjà enregistrées (retouche/rebut) dépassent l’inspecté en taille ${sizeId}.`,
          409,
        );
      }
      db.prepare(
        `UPDATE cq_controle_lines SET inspected_qty = ?, conforme_qty = ?
         WHERE controle_id = ? AND size_id = ?`,
      ).run(inspected, conforme, controleId, sizeId);
    }
    if (control.status === 'en_attente') {
      db.prepare(
        "UPDATE cq_controles SET status = 'en_cours', updated_at = datetime('now') WHERE id = ?",
      ).run(controleId);
    }
    checkControlCoherence(db, controleId, control.lot_id);
    addHistory(db, {
      action: 'CONTROLE_RESULTS_SUBMITTED',
      entityType: 'cq_controle',
      entityId: controleId,
      actorId: actor.id,
      newValue: { lines: rawLines },
    });
  });
  update();
}

/** Demande de validation : vérifie que toutes les pièces sont décidées. */
export function requestValidation(actor: Actor, rawId: unknown): void {
  requireCq(actor);
  const db = sessionsDb();
  const controleId = requireId(rawId, 'Contrôle');
  const control = requireControl(db, controleId);
  if (!['en_cours', 'incomplet'].includes(control.status)) {
    throw new ServiceError(
      'Seul un contrôle en cours ou incomplet peut être soumis à validation.',
      409,
    );
  }
  const lines = db
    .prepare(
      'SELECT size_id, inspected_qty FROM cq_controle_lines WHERE controle_id = ?',
    )
    .all(controleId) as Array<{ size_id: number; inspected_qty: number }>;
  const problems: string[] = [];
  for (const line of lines) {
    const decided = decidedDefauts(db, controleId, line.size_id);
    const conforme = (
      db
        .prepare(
          'SELECT conforme_qty FROM cq_controle_lines WHERE controle_id = ? AND size_id = ?',
        )
        .get(controleId, line.size_id) as { conforme_qty: number }
    ).conforme_qty;
    const pending =
      line.inspected_qty - conforme - decided.rework - decided.rebut;
    if (pending > 0) {
      problems.push(
        `taille ${line.size_id} : ${pending} pièce(s) sans décision définitive`,
      );
    }
    if (decided.pendingDefauts > 0) {
      problems.push(
        `taille ${line.size_id} : ${decided.pendingDefauts} pièce(s) avec défauts en attente de décision`,
      );
    }
  }
  if (problems.length > 0) {
    db.prepare(
      "UPDATE cq_controles SET status = 'incomplet', updated_at = datetime('now') WHERE id = ?",
    ).run(controleId);
    throw new ServiceError(
      `Validation impossible — décisions manquantes : ${problems.join(' ; ')}.`,
      409,
    );
  }
  db.prepare(
    "UPDATE cq_controles SET status = 'attente_validation', updated_at = datetime('now') WHERE id = ?",
  ).run(controleId);
  addHistory(db, {
    action: 'CONTROLE_VALIDATION_REQUESTED',
    entityType: 'cq_controle',
    entityId: controleId,
    actorId: actor.id,
  });
}

/** Valide le contrôle après relecture de la cohérence. */
export function validateControl(actor: Actor, rawId: unknown): void {
  requireCq(actor);
  const db = sessionsDb();
  const controleId = requireId(rawId, 'Contrôle');
  const update = db.transaction(() => {
    const control = requireControl(db, controleId);
    if (control.status !== 'attente_validation') {
      throw new ServiceError(
        'Seul un contrôle en attente de validation peut être validé.',
        409,
      );
    }
    checkControlCoherence(db, controleId, control.lot_id);
    const lines = db
      .prepare(
        'SELECT size_id, inspected_qty FROM cq_controle_lines WHERE controle_id = ?',
      )
      .all(controleId) as Array<{ size_id: number; inspected_qty: number }>;
    for (const line of lines) {
      const decided = decidedDefauts(db, controleId, line.size_id);
      const conforme = (
        db
          .prepare(
            'SELECT conforme_qty FROM cq_controle_lines WHERE controle_id = ? AND size_id = ?',
          )
          .get(controleId, line.size_id) as { conforme_qty: number }
      ).conforme_qty;
      if (line.inspected_qty - conforme - decided.rework - decided.rebut > 0) {
        throw new ServiceError(
          `Des pièces restent en attente de décision en taille ${line.size_id}.`,
          409,
        );
      }
    }
    db.prepare(
      "UPDATE cq_controles SET status = 'valide', updated_at = datetime('now') WHERE id = ?",
    ).run(controleId);
    addHistory(db, {
      action: 'CONTROLE_VALIDATED',
      entityType: 'cq_controle',
      entityId: controleId,
      actorId: actor.id,
      oldValue: { status: control.status },
      newValue: { status: 'valide' },
    });
  });
  update();
}

/** Transitions simples : démarrage, blocage, déblocage, clôture. */
export function patchControlStatus(
  actor: Actor,
  rawId: unknown,
  input: Record<string, unknown>,
): CqControlDTO {
  requireCq(actor);
  const db = sessionsDb();
  const controleId = requireId(rawId, 'Contrôle');
  const action = String(input.action ?? '');
  const reason = normalizeText(input.reason, 300);
  const control = requireControl(db, controleId);
  if (action === 'start') {
    if (control.status !== 'en_attente') {
      throw new ServiceError('Seul un contrôle en attente peut démarrer.', 409);
    }
    db.prepare(
      "UPDATE cq_controles SET status = 'en_cours', updated_at = datetime('now') WHERE id = ?",
    ).run(controleId);
  } else if (action === 'block') {
    if (['valide', 'cloture'].includes(control.status)) {
      throw new ServiceError('Un contrôle validé ne peut pas être bloqué directement.', 409);
    }
    if (!reason) {
      throw new ServiceError('Un motif est obligatoire pour bloquer un contrôle.', 400);
    }
    db.prepare(
      "UPDATE cq_controles SET status = 'bloque', updated_at = datetime('now') WHERE id = ?",
    ).run(controleId);
    raiseAlert(db, {
      category: 'CONTROLE_BLOQUE_CQ',
      severity: 'warning',
      objectType: 'cq_controle',
      objectId: controleId,
      message: `Contrôle ${control.code} bloqué : ${reason}`,
      ownerRole: 'controleur_qualite',
    });
  } else if (action === 'unblock') {
    if (control.status !== 'bloque') {
      throw new ServiceError('Seul un contrôle bloqué peut être débloqué.', 409);
    }
    if (!reason) {
      throw new ServiceError('Un motif est obligatoire pour débloquer.', 400);
    }
    db.prepare(
      "UPDATE cq_controles SET status = 'en_cours', updated_at = datetime('now') WHERE id = ?",
    ).run(controleId);
  } else if (action === 'close') {
    if (control.status !== 'valide') {
      throw new ServiceError('Seul un contrôle validé peut être clôturé.', 409);
    }
    db.prepare(
      "UPDATE cq_controles SET status = 'cloture', updated_at = datetime('now') WHERE id = ?",
    ).run(controleId);
  } else {
    throw new ServiceError('Action inconnue sur le contrôle.', 400);
  }
  addHistory(db, {
    action: `CONTROLE_${action.toUpperCase()}`,
    entityType: 'cq_controle',
    entityId: controleId,
    actorId: actor.id,
    oldValue: { status: control.status },
    reason,
  });
  return getControl(actor, controleId);
}
