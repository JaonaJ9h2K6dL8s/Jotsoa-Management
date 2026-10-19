import { ServiceError } from '@/server/api/service-error';
import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import type { RtAssignmentDTO } from '@/types/retouche';
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
 * Affectation des demandes réceptionnées aux retoucheurs réellement
 * configurés. Les quantités affectées ne peuvent jamais dépasser les
 * quantités reçues, et une même quantité ne peut pas être affectée
 * deux fois (soldes recalculés depuis les mouvements réels).
 */

function availableBySize(
  db: ReturnType<typeof sessionsDb>,
  requestId: number,
): Map<number, number> {
  const received = new Map<number, number>();
  for (const row of db
    .prepare(
      `SELECT size_id, received_qty FROM rt_reception_lines
       WHERE reception_id = (SELECT id FROM rt_receptions WHERE request_id = ?)`,
    )
    .all(requestId) as Array<{ size_id: number; received_qty: number }>) {
    received.set(row.size_id, row.received_qty);
  }
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
  const available = new Map<number, number>();
  for (const [sizeId, qty] of received.entries()) {
    available.set(sizeId, Math.max(0, qty - (assigned.get(sizeId) ?? 0)));
  }
  return available;
}

function mapAssignment(
  db: ReturnType<typeof sessionsDb>,
  row: {
    id: number;
    code: string;
    request_id: number;
    request_code: string;
    lot_code: string;
    retoucheur_id: number;
    retoucheur_nom: string;
    assigned_by_name: string | null;
    status: 'affectee' | 'en_cours' | 'terminee' | 'annulee';
    notes: string | null;
    created_at: string;
  },
): RtAssignmentDTO {
  const lines = db
    .prepare(
      `SELECT al.size_id, s.nom AS size_label, al.qty
       FROM rt_assignment_lines al
       JOIN sizes s ON s.id = al.size_id
       WHERE al.assignment_id = ?
       ORDER BY s.display_order, s.id`,
    )
    .all(row.id) as Array<{ size_id: number; size_label: string; qty: number }>;
  return {
    id: row.id,
    code: row.code,
    requestId: row.request_id,
    requestCode: row.request_code,
    lotCode: row.lot_code,
    retoucheurId: row.retoucheur_id,
    retoucheurNom: row.retoucheur_nom,
    assignedByName: row.assigned_by_name,
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

const ASSIGNMENT_SELECT = `
  SELECT a.*, r.code AS request_code, l.code AS lot_code,
         ru.nom || ' ' || ru.prenom AS retoucheur_nom,
         au.nom || ' ' || au.prenom AS assigned_by_name
  FROM rt_assignments a
  JOIN cq_rework_requests r ON r.id = a.request_id
  JOIN coupe_lots l ON l.id = r.lot_id
  JOIN users ru ON ru.id = a.retoucheur_id
  LEFT JOIN users au ON au.id = a.assigned_by`;

export function listAssignments(actor: Actor): RtAssignmentDTO[] {
  requireRetouche(actor);
  const db = sessionsDb();
  return (
    db.prepare(`${ASSIGNMENT_SELECT} ORDER BY a.id DESC`).all() as never[]
  ).map((row) => mapAssignment(db, row));
}

/**
 * Affecte des quantités d'une demande réceptionnée à un retoucheur.
 * Le retoucheur doit être un utilisateur actif du rôle retoucheur.
 */
export function createAssignment(
  actor: Actor,
  input: Record<string, unknown>,
): RtAssignmentDTO {
  requireRetouche(actor);
  const db = sessionsDb();
  const requestId = requireId(input.requestId, 'Demande');
  const retoucheurId = requireId(input.retoucheurId, 'Retoucheur');
  const notes = normalizeText(input.notes, 500);
  const rawLines = Array.isArray(input.lines) ? input.lines : [];
  if (rawLines.length === 0) {
    throw new ServiceError('Aucune quantité à affecter.', 400);
  }
  const validateQuantities = (
    available: Map<number, number>,
    raiseExcess: boolean,
  ): void => {
    for (const entry of rawLines) {
      const record = entry as Record<string, unknown>;
      const sizeId = requireId(record.sizeId, 'Taille');
      const qty = toNumber(record.qty, 'La quantité affectée');
      if (qty <= 0) {
        throw new ServiceError('La quantité affectée doit être supérieure à 0.', 400);
      }
      const remaining = available.get(sizeId) ?? 0;
      if (qty > remaining) {
        if (raiseExcess) {
          raiseAlert(db, {
            category: 'AFFECTATION_EXCEDENT_RT',
            severity: 'warning',
            objectType: 'cq_rework_request',
            objectId: requestId,
            message: `Tentative d’affectation de ${qty} pièce(s) en taille ${sizeId} alors que ${remaining} restent disponibles.`,
            ownerRole: 'retoucheur',
          });
        }
        throw new ServiceError(
          `Quantité supérieure au disponible pour affectation en taille ${sizeId} (disponible : ${remaining}).`,
          409,
        );
      }
      available.set(sizeId, remaining - qty);
    }
  };
  // Validation hors transaction : l'alerte d'excédent doit persister
  // même si l'opération est refusée.
  validateQuantities(availableBySize(db, requestId), true);
  const run = db.transaction((): number => {
    const retoucheur = db
      .prepare(
        `SELECT u.id, u.is_active, r.code AS role_code
         FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
      )
      .get(retoucheurId) as
      | { id: number; is_active: number; role_code: string }
      | undefined;
    if (!retoucheur || retoucheur.role_code !== 'retoucheur' || !retoucheur.is_active) {
      throw new ServiceError(
        'Le retoucheur doit être un utilisateur actif du rôle retoucheur.',
        400,
      );
    }
    const request = db
      .prepare('SELECT id, status FROM cq_rework_requests WHERE id = ?')
      .get(requestId) as { id: number; status: string } | undefined;
    if (!request || request.status !== 'en_attente') {
      throw new ServiceError(
        'Seule une demande en cours (réceptionnée, non clôturée) peut être affectée.',
        409,
      );
    }
    const reception = db
      .prepare('SELECT id FROM rt_receptions WHERE request_id = ?')
      .get(requestId) as { id: number } | undefined;
    if (!reception) {
      throw new ServiceError(
        'La demande doit d’abord être réceptionnée avant affectation.',
        409,
      );
    }
    // Re-validation sous verrou transactionnel (requêtes concurrentes).
    validateQuantities(availableBySize(db, requestId), false);
    const code = nextCode(db, 'rt_assignments', 'AF-');
    const result = db
      .prepare(
        `INSERT INTO rt_assignments (code, request_id, retoucheur_id, assigned_by, notes)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(code, requestId, retoucheurId, actor.id, notes);
    const assignmentId = Number(result.lastInsertRowid);
    for (const entry of rawLines) {
      const record = entry as Record<string, unknown>;
      db.prepare(
        'INSERT INTO rt_assignment_lines (assignment_id, size_id, qty) VALUES (?, ?, ?)',
      ).run(assignmentId, requireId(record.sizeId, 'Taille'), toNumber(record.qty, 'La quantité'));
    }
    addHistory(db, {
      action: 'AFFECTATION_CREEE',
      entityType: 'rt_assignment',
      entityId: assignmentId,
      actorId: actor.id,
      newValue: { code, retoucheurId, lines: rawLines },
    });
    return assignmentId;
  });
  const assignmentId = run();
  const row = db
    .prepare(`${ASSIGNMENT_SELECT} WHERE a.id = ?`)
    .get(assignmentId) as never;
  return mapAssignment(db, row);
}
