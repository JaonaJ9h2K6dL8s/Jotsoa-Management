import type Database from 'better-sqlite3';

/**
 * Mécanisme central de seconde validation des opérations sensibles.
 * L'auteur soumet avec un motif obligatoire ; un autre utilisateur
 * habilité approuve ou refuse. L'auteur ne peut jamais s'auto-approuver.
 */

export interface SensitiveRequestRow {
  id: number;
  action: string;
  entity_type: string;
  entity_id: number;
  payload: string;
  reason: string;
  status: 'en_attente' | 'approuvee' | 'refusee' | 'expiree';
  requested_by: number;
  requested_at: string;
  decided_by: number | null;
  decided_at: string | null;
  decision_note: string | null;
}

export interface Actor {
  id: number | null;
  roleCode: string | null;
}

/**
 * Crée une demande de seconde validation. La version de l'état proposé
 * est conservée dans `payload` (JSON sérialisé côté appelant).
 */
export function createSensitiveRequest(
  db: Database.Database,
  input: {
    action: string;
    entityType: string;
    entityId: number;
    payload: unknown;
    reason: string;
    requestedBy: number | null;
  },
): number {
  if (!input.reason.trim()) {
    throw new Error('Un motif est obligatoire pour une opération sensible.');
  }
  const result = db
    .prepare(
      `INSERT INTO sensitive_requests
         (action, entity_type, entity_id, payload, reason, requested_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.action,
      input.entityType,
      input.entityId,
      JSON.stringify(input.payload),
      input.reason.trim(),
      input.requestedBy ?? 0,
    );
  return Number(result.lastInsertRowid);
}

export function listPendingRequests(
  db: Database.Database,
): Array<SensitiveRequestRow & { requester_nom: string | null }> {
  return db
    .prepare(
      `SELECT r.*, u.nom || ' ' || u.prenom AS requester_nom
       FROM sensitive_requests r
       LEFT JOIN users u ON u.id = r.requested_by
       WHERE r.status = 'en_attente'
       ORDER BY r.id`,
    )
    .all() as Array<SensitiveRequestRow & { requester_nom: string | null }>;
}

/**
 * Approuve une demande et exécute l'opération associée dans la
 * transaction de l'appelant via `apply`. L'auto-approbation est
 * impossible ; seul un utilisateur du rôle habilité peut approuver.
 */
export function approveSensitiveRequest(
  db: Database.Database,
  input: {
    requestId: number;
    approver: Actor;
    allowedRoles: string[];
    note: string | null;
    apply: (payload: unknown) => void;
  },
): SensitiveRequestRow {
  const request = db
    .prepare('SELECT * FROM sensitive_requests WHERE id = ?')
    .get(input.requestId) as SensitiveRequestRow | undefined;
  if (!request) throw new Error('Demande introuvable.');
  if (request.status !== 'en_attente') {
    throw new Error(
      `Cette demande a déjà été traitée (statut : ${request.status}).`,
    );
  }
  if (request.requested_by === input.approver.id) {
    throw new Error(
      "L'auteur d'une demande ne peut pas l'approuver lui-même.",
    );
  }
  if (!input.approver.roleCode || !input.allowedRoles.includes(input.approver.roleCode)) {
    throw new Error(
      "Vous n'êtes pas habilité à valider cette opération sensible.",
    );
  }
  const payload = JSON.parse(request.payload) as unknown;
  const decided = db.transaction((): unknown => {
    input.apply(payload);
    db.prepare(
      `UPDATE sensitive_requests
       SET status = 'approuvee', decided_by = ?, decided_at = datetime('now'), decision_note = ?
       WHERE id = ? AND status = 'en_attente'`,
    ).run(input.approver.id, input.note, input.requestId);
    const updated = db
      .prepare('SELECT * FROM sensitive_requests WHERE id = ?')
      .get(input.requestId) as SensitiveRequestRow;
    return updated;
  });
  return decided() as SensitiveRequestRow;
}

/** Refuse une demande avec un commentaire. L'auteur ne peut pas décider. */
export function refuseSensitiveRequest(
  db: Database.Database,
  input: {
    requestId: number;
    approver: Actor;
    allowedRoles: string[];
    note: string;
  },
): void {
  const request = db
    .prepare('SELECT * FROM sensitive_requests WHERE id = ?')
    .get(input.requestId) as SensitiveRequestRow | undefined;
  if (!request) throw new Error('Demande introuvable.');
  if (request.status !== 'en_attente') {
    throw new Error('Cette demande a déjà été traitée.');
  }
  if (request.requested_by === input.approver.id) {
    throw new Error(
      "L'auteur d'une demande ne peut pas la refuser lui-même.",
    );
  }
  if (!input.approver.roleCode || !input.allowedRoles.includes(input.approver.roleCode)) {
    throw new Error(
      "Vous n'êtes pas habilité à valider cette opération sensible.",
    );
  }
  if (!input.note.trim()) {
    throw new Error('Un commentaire est obligatoire pour refuser une demande.');
  }
  db.prepare(
    `UPDATE sensitive_requests
     SET status = 'refusee', decided_by = ?, decided_at = datetime('now'), decision_note = ?
     WHERE id = ? AND status = 'en_attente'`,
  ).run(input.approver.id, input.note.trim(), input.requestId);
}

/**
 * Invalide une demande devenue obsolète : si les données soumises ont
 * changé depuis la soumission, la validation précédente ne vaut plus.
 */
export function invalidateStaleRequests(
  db: Database.Database,
  entityType: string,
  entityId: number,
  currentPayload: unknown,
): void {
  const rows = db
    .prepare(
      `SELECT id, payload FROM sensitive_requests
       WHERE entity_type = ? AND entity_id = ? AND status = 'en_attente'`,
    )
    .all(entityType, entityId) as Array<{ id: number; payload: string }>;
  const current = JSON.stringify(currentPayload);
  for (const row of rows) {
    if (row.payload !== current) {
      db.prepare(
        "UPDATE sensitive_requests SET status = 'expiree' WHERE id = ?",
      ).run(row.id);
    }
  }
}

export function getRequestById(
  db: Database.Database,
  id: number,
): SensitiveRequestRow | undefined {
  return db
    .prepare('SELECT * FROM sensitive_requests WHERE id = ?')
    .get(id) as SensitiveRequestRow | undefined;
}
