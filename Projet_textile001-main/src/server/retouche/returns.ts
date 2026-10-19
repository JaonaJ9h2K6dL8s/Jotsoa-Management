import { ServiceError } from '@/server/api/service-error';
import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import type { RtReturnDTO } from '@/types/retouche';
import { raiseAlert } from '@/server/alerts/alerts';
import {
  addHistory,
  nextCode,
  normalizeText,
  requireId,
  requireRetouche,
  toNumber,
} from './common';

/**
 * Retour des quantités réparées au Contrôle qualité pour le contrôle
 * final. Seules les quantités réellement traitées avec le résultat
 * « repare » peuvent être retournées ; les pièces non réparables ou
 * partielles ne partent jamais. Aucune entrée stock n'est créée ici :
 * le Contrôle qualité reste décisionnaire (contrôle final étape 6).
 */

function repairedNotReturnedBySize(
  db: ReturnType<typeof sessionsDb>,
  requestId: number,
): Map<number, number> {
  const repaired = new Map<number, number>();
  for (const row of db
    .prepare(
      `SELECT il.size_id,
              SUM(CASE WHEN il.result = 'repare' THEN il.processed_qty
                       WHEN il.result = 'partiel' THEN il.processed_qty ELSE 0 END) AS qty
       FROM rt_intervention_lines il
       JOIN rt_interventions i ON i.id = il.intervention_id
       JOIN rt_assignments a ON a.id = i.assignment_id
       WHERE a.request_id = ? AND i.status = 'terminee'
       GROUP BY il.size_id`,
    )
    .all(requestId) as Array<{ size_id: number; qty: number }>) {
    repaired.set(row.size_id, row.qty);
  }
  const returned = new Map<number, number>();
  for (const row of db
    .prepare(
      `SELECT rl.size_id, SUM(rl.qty) AS qty FROM rt_return_lines rl
       JOIN rt_returns t ON t.id = rl.return_id
       WHERE t.request_id = ? AND t.status = 'transmis'
       GROUP BY rl.size_id`,
    )
    .all(requestId) as Array<{ size_id: number; qty: number }>) {
    returned.set(row.size_id, row.qty);
  }
  const available = new Map<number, number>();
  for (const [sizeId, qty] of repaired.entries()) {
    available.set(sizeId, Math.max(0, qty - (returned.get(sizeId) ?? 0)));
  }
  return available;
}

const RETURN_SELECT = `
  SELECT t.*, r.code AS request_code, l.code AS lot_code,
         u.nom || ' ' || u.prenom AS returned_by_name
  FROM rt_returns t
  JOIN cq_rework_requests r ON r.id = t.request_id
  JOIN coupe_lots l ON l.id = r.lot_id
  LEFT JOIN users u ON u.id = t.returned_by`;

function mapReturn(
  db: ReturnType<typeof sessionsDb>,
  row: {
    id: number;
    code: string;
    request_id: number;
    request_code: string;
    lot_code: string;
    returned_by_name: string | null;
    status: 'transmis' | 'annule';
    notes: string | null;
    created_at: string;
  },
): RtReturnDTO {
  const lines = db
    .prepare(
      `SELECT rl.size_id, s.nom AS size_label, rl.qty
       FROM rt_return_lines rl
       JOIN sizes s ON s.id = rl.size_id
       WHERE rl.return_id = ?
       ORDER BY s.display_order, s.id`,
    )
    .all(row.id) as Array<{ size_id: number; size_label: string; qty: number }>;
  return {
    id: row.id,
    code: row.code,
    requestId: row.request_id,
    requestCode: row.request_code,
    lotCode: row.lot_code,
    returnedByName: row.returned_by_name,
    status: row.status,
    notes: row.notes,
    createdAt: row.created_at,
    lines: lines.map((line) => ({
      sizeId: line.size_id,
      sizeLabel: line.size_label,
      qty: line.qty,
    })),
  };
}

export function listReturns(actor: Actor): RtReturnDTO[] {
  requireRetouche(actor);
  const db = sessionsDb();
  return (
    db.prepare(`${RETURN_SELECT} ORDER BY t.id DESC`).all() as never[]
  ).map((row) => mapReturn(db, row));
}

/** Quantités réparées disponibles pour le retour d'une demande. */
export function returnAvailability(
  db: ReturnType<typeof sessionsDb>,
  requestId: number,
): Array<{ sizeId: number; available: number }> {
  return [...repairedNotReturnedBySize(db, requestId).entries()].map(
    ([sizeId, available]) => ({ sizeId, available }),
  );
}

/**
 * Transmet les quantités réparées au Contrôle qualité. Le contrôle
 * final (étape 6) pourra alors être ouvert par le contrôleur qualité.
 * Transaction : tout échec annule l'opération complète.
 */
export function createReturn(
  actor: Actor,
  input: Record<string, unknown>,
): RtReturnDTO {
  requireRetouche(actor);
  const db = sessionsDb();
  const requestId = requireId(input.requestId, 'Demande');
  const notes = normalizeText(input.notes, 500);
  const rawLines = Array.isArray(input.lines) ? input.lines : [];
  if (rawLines.length === 0) {
    throw new ServiceError('Aucune quantité à retourner.', 400);
  }
  const validateQuantities = (
    available: Map<number, number>,
    raiseExcess: boolean,
  ): void => {
    for (const entry of rawLines) {
      const record = entry as Record<string, unknown>;
      const sizeId = requireId(record.sizeId, 'Taille');
      const qty = toNumber(record.qty, 'La quantité retournée');
      if (qty <= 0) {
        throw new ServiceError('La quantité retournée doit être supérieure à 0.', 400);
      }
      const remaining = available.get(sizeId) ?? 0;
      if (qty > remaining) {
        if (raiseExcess) {
          raiseAlert(db, {
            category: 'RETOUR_EXCEDENT_RT',
            severity: 'warning',
            objectType: 'cq_rework_request',
            objectId: requestId,
            message: `Tentative de retour de ${qty} pièce(s) en taille ${sizeId} alors que ${remaining} réparée(s) restent disponibles.`,
            ownerRole: 'retoucheur',
          });
        }
        throw new ServiceError(
          `Quantité supérieure aux réparations disponibles en taille ${sizeId} (disponible : ${remaining}).`,
          409,
        );
      }
      available.set(sizeId, remaining - qty);
    }
  };
  // Validation hors transaction : l'alerte d'excédent doit persister
  // même si l'opération est refusée.
  validateQuantities(repairedNotReturnedBySize(db, requestId), true);
  const run = db.transaction((): number => {
    const request = db
      .prepare('SELECT id, status FROM cq_rework_requests WHERE id = ?')
      .get(requestId) as { id: number; status: string } | undefined;
    if (!request) throw new ServiceError('Demande introuvable.', 404);
    if (request.status !== 'en_attente') {
      throw new ServiceError(
        'Cette demande est déjà transmise au contrôle final ou clôturée.',
        409,
      );
    }
    const reception = db
      .prepare('SELECT id FROM rt_receptions WHERE request_id = ?')
      .get(requestId) as { id: number } | undefined;
    if (!reception) {
      throw new ServiceError('La demande n’a pas encore été réceptionnée.', 409);
    }
    // Re-validation sous verrou transactionnel (requêtes concurrentes).
    validateQuantities(repairedNotReturnedBySize(db, requestId), false);
    const code = nextCode(db, 'rt_returns', 'RC-');
    const result = db
      .prepare('INSERT INTO rt_returns (code, request_id, returned_by, notes) VALUES (?, ?, ?, ?)')
      .run(code, requestId, actor.id, notes);
    const returnId = Number(result.lastInsertRowid);
    for (const entry of rawLines) {
      const record = entry as Record<string, unknown>;
      db.prepare(
        'INSERT INTO rt_return_lines (return_id, size_id, qty) VALUES (?, ?, ?)',
      ).run(returnId, requireId(record.sizeId, 'Taille'), toNumber(record.qty, 'La quantité'));
    }
    addHistory(db, {
      action: 'RETOUR_CONTROLE_QUALITE',
      entityType: 'rt_return',
      entityId: returnId,
      actorId: actor.id,
      newValue: { code, requestId, lines: rawLines },
    });
    return returnId;
  });
  const returnId = run();
  const row = db
    .prepare(`${RETURN_SELECT} WHERE t.id = ?`)
    .get(returnId) as never;
  return mapReturn(db, row);
}
