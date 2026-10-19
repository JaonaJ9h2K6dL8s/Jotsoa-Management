import { ServiceError } from '@/server/api/service-error';
import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import type { RtReceptionDTO, RtRequestDTO } from '@/types/retouche';
import { raiseAlert } from '@/server/alerts/alerts';
import { addHistory, normalizeText, requireRetouche, requireId } from './common';

/**
 * Demandes de retouche et leur réception. Une demande provient
 * exclusivement d'une décision réelle du Contrôle qualité
 * (cq_rework_requests). Le module Retouche ne modifie jamais la
 * demande initiale : il trace réception, affectations, interventions
 * et retours dans ses propres tables.
 */

const REQUEST_SELECT = `
  SELECT r.*, c.code AS controle_code, l.code AS lot_code,
         p.nom AS product_nom, c2.nom AS color_nom,
         u.nom || ' ' || u.prenom AS requested_by_name,
         rec.id AS reception_id
  FROM cq_rework_requests r
  JOIN cq_controles c ON c.id = r.controle_id
  JOIN coupe_lots l ON l.id = r.lot_id
  JOIN products p ON p.id = l.product_id
  JOIN colors c2 ON c2.id = l.color_id
  LEFT JOIN users u ON u.id = r.requested_by
  LEFT JOIN rt_receptions rec ON rec.request_id = r.id`;

interface RequestRow {
  id: number;
  code: string;
  controle_id: number;
  controle_code: string;
  lot_id: number;
  lot_code: string;
  product_nom: string;
  color_nom: string;
  origin: 'initial' | 'final';
  origin_final: number | null;
  status: 'en_attente' | 'acceptee' | 'refusee' | 'annulee';
  reason: string;
  requested_by_name: string | null;
  created_at: string;
  reception_id: number | null;
}

function totalsBySize(
  db: ReturnType<typeof sessionsDb>,
  requestId: number,
): {
  assigned: Map<number, number>;
  processed: Map<number, number>;
  repaired: Map<number, number>;
  returned: Map<number, number>;
  irreparable: Map<number, number>;
} {
  const assigned = new Map<number, number>();
  for (const row of db
    .prepare(
      `SELECT al.size_id, SUM(al.qty) AS qty FROM rt_assignment_lines al
       JOIN rt_assignments a ON a.id = al.assignment_id
       WHERE a.request_id = ? AND a.status != 'annulee'
       GROUP BY al.size_id`,
    )
    .all(requestId) as Array<{ size_id: number; qty: number }>) {
    assigned.set(row.size_id, row.qty);
  }
  const processed = new Map<number, number>();
  const repaired = new Map<number, number>();
  const irreparable = new Map<number, number>();
  for (const row of db
    .prepare(
      `SELECT il.size_id,
              SUM(il.processed_qty) AS processed,
              SUM(CASE WHEN il.result = 'repare' THEN il.processed_qty ELSE 0 END) AS repared,
              SUM(CASE WHEN il.result = 'irreparable' THEN il.processed_qty ELSE 0 END) AS irreparable
       FROM rt_intervention_lines il
       JOIN rt_interventions i ON i.id = il.intervention_id
       JOIN rt_assignments a ON a.id = i.assignment_id
       WHERE a.request_id = ? AND i.status = 'terminee'
       GROUP BY il.size_id`,
    )
    .all(requestId) as Array<{
    size_id: number;
    processed: number;
    repared: number;
    irreparable: number;
  }>) {
    processed.set(row.size_id, row.processed);
    repaired.set(row.size_id, row.repared);
    irreparable.set(row.size_id, row.irreparable);
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
  return { assigned, processed, repaired, returned, irreparable };
}

function mapRequest(
  db: ReturnType<typeof sessionsDb>,
  row: RequestRow,
): RtRequestDTO {
  const lines = (
    db
      .prepare(
        `SELECT rl.size_id, s.nom AS size_label, rl.qty AS requested_qty,
                COALESCE(rec.received_qty, 0) AS received_qty
         FROM cq_rework_lines rl
         JOIN sizes s ON s.id = rl.size_id
         LEFT JOIN rt_reception_lines rec
           ON rec.size_id = rl.size_id
          AND rec.reception_id = COALESCE(?, -1)
         WHERE rl.request_id = ?
         ORDER BY s.display_order, s.id`,
      )
      .all(row.reception_id, row.id) as Array<{
      size_id: number;
      size_label: string;
      requested_qty: number;
      received_qty: number;
    }>
  ).map((line) => ({
    sizeId: line.size_id,
    sizeLabel: line.size_label,
    requestedQty: line.requested_qty,
    receivedQty: line.received_qty,
  }));
  const totals = totalsBySize(db, row.id);
  const sum = (map: Map<number, number>) =>
    [...map.values()].reduce((acc, value) => acc + value, 0);
  return {
    id: row.id,
    code: row.code,
    controleId: row.controle_id,
    controleCode: row.controle_code,
    lotId: row.lot_id,
    lotCode: row.lot_code,
    productNom: row.product_nom,
    colorNom: row.color_nom,
    origin: row.origin,
    originFinalId: row.origin_final,
    status: row.status,
    reason: row.reason,
    requestedByName: row.requested_by_name,
    createdAt: row.created_at,
    receptionId: row.reception_id,
    lines,
    assignedQty: sum(totals.assigned),
    processedQty: sum(totals.processed),
    returnedQty: sum(totals.returned),
  };
}

export function listRequests(actor: Actor): RtRequestDTO[] {
  requireRetouche(actor);
  const db = sessionsDb();
  return (
    db.prepare(`${REQUEST_SELECT} ORDER BY r.id DESC`).all() as RequestRow[]
  ).map((row) => mapRequest(db, row));
}

export function getRequest(actor: Actor, rawId: unknown): RtRequestDTO {
  requireRetouche(actor);
  const id = requireId(rawId, 'Demande');
  const db = sessionsDb();
  const row = db
    .prepare(`${REQUEST_SELECT} WHERE r.id = ?`)
    .get(id) as RequestRow | undefined;
  if (!row) throw new ServiceError('Demande de retouche introuvable.', 404);
  return mapRequest(db, row);
}

export function listReceptions(actor: Actor): RtReceptionDTO[] {
  requireRetouche(actor);
  const db = sessionsDb();
  return (
    db
      .prepare(
        `SELECT rec.id, rec.request_id, rec.notes, rec.created_at,
                r.code AS request_code,
                u.nom || ' ' || u.prenom AS received_by_name
         FROM rt_receptions rec
         JOIN cq_rework_requests r ON r.id = rec.request_id
         LEFT JOIN users u ON u.id = rec.received_by
         ORDER BY rec.id DESC`,
      )
      .all() as Array<{
      id: number;
      request_id: number;
      notes: string | null;
      created_at: string;
      request_code: string;
      received_by_name: string | null;
    }>
  ).map((row) => ({
    id: row.id,
    requestCode: row.request_code,
    receivedByName: row.received_by_name,
    notes: row.notes,
    createdAt: row.created_at,
    lines: (
      db
        .prepare(
          `SELECT rl.size_id, s.nom AS size_label,
                  rec.requested_qty, rec.received_qty
           FROM rt_reception_lines rec
           JOIN sizes s ON s.id = rec.size_id
           WHERE rec.reception_id = ?
           ORDER BY s.display_order, s.id`,
        )
        .all(row.id) as Array<{
        size_id: number;
        size_label: string;
        requested_qty: number;
        received_qty: number;
      }>
    ).map((line) => ({
      sizeId: line.size_id,
      sizeLabel: line.size_label,
      requestedQty: line.requested_qty,
      receivedQty: line.received_qty,
    })),
  }));
}

/**
 * Réceptionne une demande : quantités reçues saisies par taille. Un
 * écart (reçu < demandé) est alerté ; la quantité non reçue reste
 * distincte et ne peut jamais être affectée ensuite. Toute l'écriture
 * est transactionnelle : une réception en double est refusée.
 */
export function receiveRequest(
  actor: Actor,
  rawId: unknown,
  input: Record<string, unknown>,
): RtRequestDTO {
  requireRetouche(actor);
  const db = sessionsDb();
  const requestId = requireId(rawId, 'Demande');
  const notes = normalizeText(input.notes, 500);
  const rawLines = Array.isArray(input.lines) ? input.lines : [];
  if (rawLines.length === 0) {
    throw new ServiceError('Aucune quantité reçue fournie.', 400);
  }
  // Détection de doublon hors transaction : l'alerte de tentative de
  // double réception doit persister même si l'opération est refusée.
  const existing = db
    .prepare('SELECT id FROM rt_receptions WHERE request_id = ?')
    .get(requestId) as { id: number } | undefined;
  if (existing) {
    raiseAlert(db, {
      category: 'DOUBLON_RECEPTION_RT',
      severity: 'warning',
      objectType: 'cq_rework_request',
      objectId: requestId,
      message: `Tentative de réception en double de la demande #${requestId}.`,
      ownerRole: 'retoucheur',
    });
    throw new ServiceError('Cette demande a déjà été réceptionnée.', 409);
  }
  const run = db.transaction((): void => {
    const request = db
      .prepare(
        `SELECT id, status FROM cq_rework_requests WHERE id = ?`,
      )
      .get(requestId) as { id: number; status: string } | undefined;
    if (!request) throw new ServiceError('Demande de retouche introuvable.', 404);
    if (request.status !== 'en_attente') {
      throw new ServiceError(
        'Cette demande est déjà clôturée ou annulée par le Contrôle qualité.',
        409,
      );
    }
    const result = db
      .prepare('INSERT INTO rt_receptions (request_id, received_by, notes) VALUES (?, ?, ?)')
      .run(requestId, actor.id, notes);
    const receptionId = Number(result.lastInsertRowid);
    for (const entry of rawLines) {
      const record = entry as Record<string, unknown>;
      const sizeId = requireId(record.sizeId, 'Taille');
      const received = Number(
        String(record.receivedQty ?? '0').replace(',', '.'),
      );
      if (!Number.isFinite(received) || received < 0) {
        throw new ServiceError('La quantité reçue doit être numérique positive.', 400);
      }
      const line = db
        .prepare('SELECT qty FROM cq_rework_lines WHERE request_id = ? AND size_id = ?')
        .get(requestId, sizeId) as { qty: number } | undefined;
      if (!line) {
        throw new ServiceError(
          'Cette taille ne fait pas partie de la demande de retouche.',
          400,
        );
      }
      if (received > line.qty) {
        throw new ServiceError(
          `Quantité reçue (${received}) supérieure à la quantité demandée (${line.qty}) en taille ${sizeId}.`,
          409,
        );
      }
      db.prepare(
        `INSERT INTO rt_reception_lines
           (reception_id, size_id, requested_qty, received_qty)
         VALUES (?, ?, ?, ?)`,
      ).run(receptionId, sizeId, line.qty, received);
      if (received < line.qty) {
        raiseAlert(db, {
          category: 'ECART_RECEPTION_RT',
          severity: 'warning',
          objectType: 'cq_rework_request',
          objectId: requestId,
          message: `Écart de réception sur la demande ${requestId} : ${line.qty - received} pièce(s) manquante(s) en taille ${sizeId}.`,
          ownerRole: 'retoucheur',
        });
      }
    }
    addHistory(db, {
      action: 'DEMANDE_RECUE',
      entityType: 'cq_rework_request',
      entityId: requestId,
      actorId: actor.id,
      newValue: { receptionId },
      reason: notes,
    });
  });
  run();
  return getRequest(actor, requestId);
}
