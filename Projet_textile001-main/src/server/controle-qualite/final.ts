import { ServiceError } from '@/server/api/service-error';
import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import type { FinalControlDTO } from '@/types/cq';
import { raiseAlert } from '@/server/alerts/alerts';
import {
  addHistory,
  nextCode,
  normalizeText,
  requireCq,
  requireId,
  toNumber,
} from './common';

/**
 * Contrôle final après retouche. Lié à une demande de retouche : les
 * quantités revenues sont saisies par taille puis decisions finales
 * (conforme / nouvelle retouche / rebut). Une même quantité ne peut
 * jamais être déclarée conforme deux fois ni transférée deux fois —
 * les soldes sont recalculés depuis les mouvements réels.
 */

interface FinalBasic {
  id: number;
  code: string;
  request_id: number;
  lot_id: number;
  status: string;
}

function requireFinal(db: ReturnType<typeof sessionsDb>, finalId: number): FinalBasic {
  const row = db
    .prepare('SELECT id, code, request_id, lot_id, status FROM cq_final_controls WHERE id = ?')
    .get(finalId) as FinalBasic | undefined;
  if (!row) throw new ServiceError('Contrôle final introuvable.', 404);
  return row;
}

const FINAL_SELECT = `
  SELECT f.*, rw.code AS request_code, l.code AS lot_code,
         u.nom || ' ' || u.prenom AS controlled_by_name
  FROM cq_final_controls f
  JOIN cq_rework_requests rw ON rw.id = f.request_id
  JOIN coupe_lots l ON l.id = f.lot_id
  JOIN users u ON u.id = f.controlled_by`;

function mapFinal(
  db: ReturnType<typeof sessionsDb>,
  row: {
    id: number;
    code: string;
    request_id: number;
    lot_id: number;
    status: 'en_cours' | 'valide' | 'cloture';
    controlled_by_name: string | null;
    notes: string | null;
    created_at: string;
    request_code: string;
    lot_code: string;
  },
): FinalControlDTO {
  const lines = db
    .prepare(
      `SELECT fl.size_id, s.nom AS size_label, fl.returned_qty,
              fl.conforme_qty, fl.rework_qty, fl.rebut_qty,
              COALESCE(sent.qty, 0) AS sent_qty
       FROM cq_final_lines fl
       JOIN sizes s ON s.id = fl.size_id
       LEFT JOIN cq_rework_lines sent ON sent.request_id = ? AND sent.size_id = fl.size_id
       WHERE fl.final_id = ? ORDER BY s.display_order, s.id`,
    )
    .all(row.request_id, row.id) as Array<{
    size_id: number;
    size_label: string;
    sent_qty: number;
    returned_qty: number;
    conforme_qty: number;
    rework_qty: number;
    rebut_qty: number;
  }>;
  return {
    id: row.id,
    code: row.code,
    requestId: row.request_id,
    requestCode: row.request_code,
    lotId: row.lot_id,
    lotCode: row.lot_code,
    status: row.status,
    controlledByName: row.controlled_by_name,
    notes: row.notes,
    createdAt: row.created_at,
    lines: lines.map((line) => ({
      sizeId: line.size_id,
      sizeLabel: line.size_label,
      sentQty: line.sent_qty,
      returnedQty: line.returned_qty,
      conformeQty: line.conforme_qty,
      reworkQty: line.rework_qty,
      rebutQty: line.rebut_qty,
    })),
  };
}

export function listFinalControls(actor: Actor): FinalControlDTO[] {
  requireCq(actor);
  const db = sessionsDb();
  return (db.prepare(`${FINAL_SELECT} ORDER BY f.id DESC`).all() as never[]).map(
    (row) => mapFinal(db, row),
  );
}

export function getFinalControl(actor: Actor, rawId: unknown): FinalControlDTO {
  requireCq(actor);
  const id = requireId(rawId, 'Contrôle final');
  const db = sessionsDb();
  const row = db.prepare(`${FINAL_SELECT} WHERE f.id = ?`).get(id) as never;
  if (!row) throw new ServiceError('Contrôle final introuvable.', 404);
  return mapFinal(db, row);
}

/**
 * Ouvre le contrôle final d'une demande de retouche : les pièces
 * reviennent de retouche (point d'intégration étape 7) et la demande
 * passe « acceptee ». Une demande déjà traitée refuse un second contrôle.
 */
export function createFinalControl(
  actor: Actor,
  input: Record<string, unknown>,
): FinalControlDTO {
  requireCq(actor);
  const db = sessionsDb();
  const requestId = requireId(input.requestId, 'Demande de retouche');
  const notes = normalizeText(input.notes, 500);
  const insert = db.transaction((): number => {
    const request = db
      .prepare('SELECT id, lot_id, status FROM cq_rework_requests WHERE id = ?')
      .get(requestId) as
      | { id: number; lot_id: number; status: string }
      | undefined;
    if (!request) throw new ServiceError('Demande de retouche introuvable.', 404);
    if (request.status !== 'en_attente') {
      throw new ServiceError(
        'Seule une demande de retouche en attente peut faire l’objet d’un contrôle final.',
        409,
      );
    }
    const existing = db
      .prepare('SELECT id FROM cq_final_controls WHERE request_id = ?')
      .get(requestId) as { id: number } | undefined;
    if (existing) {
      throw new ServiceError('Un contrôle final existe déjà pour cette demande.', 409);
    }
    const code = nextCode(db, 'cq_final_controls', 'CF-');
    const result = db
      .prepare(
        `INSERT INTO cq_final_controls (code, request_id, lot_id, status, controlled_by, notes)
         VALUES (?, ?, ?, 'en_cours', ?, ?)`,
      )
      .run(code, requestId, request.lot_id, actor.id, notes);
    const finalId = Number(result.lastInsertRowid);
    const sent = db
      .prepare('SELECT size_id, qty FROM cq_rework_lines WHERE request_id = ?')
      .all(requestId) as Array<{ size_id: number; qty: number }>;
    for (const line of sent) {
      db.prepare(
        'INSERT INTO cq_final_lines (final_id, size_id, returned_qty) VALUES (?, ?, 0)',
      ).run(finalId, line.size_id);
    }
    db.prepare(
      "UPDATE cq_rework_requests SET status = 'acceptee' WHERE id = ?",
    ).run(requestId);
    addHistory(db, {
      action: 'FINAL_CONTROL_CREATED',
      entityType: 'cq_final_control',
      entityId: finalId,
      actorId: actor.id,
      newValue: { code, requestId },
    });
    return finalId;
  });
  const finalId = insert();
  return getFinalControl(actor, finalId);
}

/** Saisie des quantités revenues et des décisions par taille. */
export function submitFinalResults(
  actor: Actor,
  rawId: unknown,
  input: Record<string, unknown>,
): void {
  requireCq(actor);
  const db = sessionsDb();
  const finalId = requireId(rawId, 'Contrôle final');
  const rawLines = Array.isArray(input.lines) ? input.lines : [];
  if (rawLines.length === 0) {
    throw new ServiceError('Aucune quantité fournie.', 400);
  }
  const update = db.transaction(() => {
    const final = requireFinal(db, finalId);
    if (final.status !== 'en_cours') {
      throw new ServiceError(
        'Ce contrôle final n’accepte plus de saisie.',
        409,
      );
    }
    for (const entry of rawLines) {
      const record = entry as Record<string, unknown>;
      const sizeId = requireId(record.sizeId, 'Taille');
      const returned = toNumber(record.returnedQty, 'La quantité revenue');
      const conforme = toNumber(record.conformeQty, 'La quantité conforme');
      const rework = toNumber(record.reworkQty, 'La quantité à retoucher');
      const rebut = toNumber(record.rebutQty, 'La quantité rebutée');
      if (
        returned < 0 || conforme < 0 || rework < 0 || rebut < 0
      ) {
        throw new ServiceError('Les quantités ne peuvent pas être négatives.', 400);
      }
      const sent = db
        .prepare(
          'SELECT qty FROM cq_rework_lines WHERE request_id = ? AND size_id = ?',
        )
        .get(final.request_id, sizeId) as { qty: number } | undefined;
      if (!sent) {
        throw new ServiceError(
          'Cette taille ne fait pas partie de la demande de retouche.',
          400,
        );
      }
      if (returned > sent.qty) {
        throw new ServiceError(
          `Quantité revenue (${returned}) supérieure aux pièces envoyées en retouche (${sent.qty}) en taille ${sizeId}.`,
          409,
        );
      }
      if (conforme + rework + rebut > returned) {
        throw new ServiceError(
          `Les décisions (conforme + retouche + rebut) dépassent la quantité revenue en taille ${sizeId}.`,
          409,
        );
      }
      db.prepare(
        `UPDATE cq_final_lines SET returned_qty = ?, conforme_qty = ?,
           rework_qty = ?, rebut_qty = ? WHERE final_id = ? AND size_id = ?`,
      ).run(returned, conforme, rework, rebut, finalId, sizeId);
      if (rebut > 0) {
        raiseAlert(db, {
          category: 'REBUT_FINAL_CQ',
          severity: 'warning',
          objectType: 'cq_final_control',
          objectId: finalId,
          message: `Rebut déclaré au contrôle final ${final.code} : ${rebut} pièce(s) en taille ${sizeId}.`,
          ownerRole: 'controleur_qualite',
        });
      }
    }
    addHistory(db, {
      action: 'FINAL_RESULTS_SUBMITTED',
      entityType: 'cq_final_control',
      entityId: finalId,
      actorId: actor.id,
      newValue: { lines: rawLines },
    });
  });
  update();
}

/**
 * Valide le contrôle final : les quantités en nouvelle retouche
 * génèrent une nouvelle demande traçable (origin « final »), les
 * quantités conformes redeviennent disponibles pour le stock.
 */
export function validateFinalControl(
  actor: Actor,
  rawId: unknown,
  input: Record<string, unknown>,
): FinalControlDTO {
  requireCq(actor);
  const db = sessionsDb();
  const finalId = requireId(rawId, 'Contrôle final');
  const reason = normalizeText(input.reason, 300);
  const validate = db.transaction((): void => {
    const final = requireFinal(db, finalId);
    if (final.status !== 'en_cours') {
      throw new ServiceError('Seul un contrôle final en cours peut être validé.', 409);
    }
    const lines = db
      .prepare('SELECT size_id, rework_qty FROM cq_final_lines WHERE final_id = ?')
      .all(finalId) as Array<{ size_id: number; rework_qty: number }>;
    const reworkLines = lines.filter((line) => line.rework_qty > 0);
    if (reworkLines.length > 0 && !reason) {
      throw new ServiceError(
        'Un motif est obligatoire pour renvoyer des pièces en nouvelle retouche.',
        400,
      );
    }
    if (reworkLines.length > 0) {
      const code = nextCode(db, 'cq_rework_requests', 'RT-');
      const result = db
        .prepare(
          `INSERT INTO cq_rework_requests
             (code, controle_id, lot_id, origin, origin_final, status, reason, requested_by)
           SELECT ?, rw.controle_id, fc.lot_id, 'final', ?, 'en_attente', ?, ?
           FROM cq_final_controls fc
           JOIN cq_rework_requests rw ON rw.id = fc.request_id
           WHERE fc.id = ?`,
        )
        .run(code, finalId, reason, actor.id, finalId);
      const newRequestId = Number(result.lastInsertRowid);
      for (const line of reworkLines) {
        db.prepare(
          'INSERT INTO cq_rework_lines (request_id, size_id, qty) VALUES (?, ?, ?)',
        ).run(newRequestId, line.size_id, line.rework_qty);
      }
      addHistory(db, {
        action: 'REWORK_REQUESTED',
        entityType: 'cq_rework_request',
        entityId: newRequestId,
        actorId: actor.id,
        newValue: { code, origin: 'final', finalId },
        reason,
      });
    }
    db.prepare(
      "UPDATE cq_final_controls SET status = 'valide', updated_at = datetime('now') WHERE id = ?",
    ).run(finalId);
    addHistory(db, {
      action: 'FINAL_CONTROL_VALIDATED',
      entityType: 'cq_final_control',
      entityId: finalId,
      actorId: actor.id,
      oldValue: { status: 'en_cours' },
      newValue: { status: 'valide' },
    });
  });
  validate();
  return getFinalControl(actor, finalId);
}
