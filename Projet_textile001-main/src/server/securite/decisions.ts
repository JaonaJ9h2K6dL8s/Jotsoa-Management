import { ServiceError } from '@/server/api/service-error';
import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import { raiseAlert } from '@/server/alerts/alerts';
import type { SecDecision, SecDecisionDTO, SecSortieDTO } from '@/types/securite';
import { addSecHistory, nextSecCode, normalizeText, requireId, requireSecurite } from './common';

/**
 * Décision de contrôle du Chef Sécurité. L'autorisation de sortie ne
 * signifie jamais que les cartons ont quitté l'usine : la sortie
 * physique est confirmée séparément (sorties.ts).
 */

const DOSSIER_SELECT = `
  SELECT d.*, o.code AS order_code
  FROM mg_dossiers d JOIN mg_orders o ON o.id = d.order_id`;

function mapDecision(row: {
  id: number;
  dossier_id: number;
  dossier_code: string;
  decision: SecDecision;
  reason: string | null;
  decided_by_name: string | null;
  decided_at: string;
}): SecDecisionDTO {
  return {
    id: row.id,
    dossierId: row.dossier_id,
    dossierCode: row.dossier_code,
    decision: row.decision,
    reason: row.reason,
    decidedByName: row.decided_by_name,
    decidedAt: row.decided_at,
  };
}

export function listDecisions(actor: Actor): SecDecisionDTO[] {
  requireSecurite(actor);
  const db = sessionsDb();
  return (
    db
      .prepare(
        `SELECT s.id, s.dossier_id, d.code AS dossier_code, s.decision, s.reason,
                u.nom || ' ' || u.prenom AS decided_by_name, s.decided_at
         FROM sec_decisions s
         JOIN mg_dossiers d ON d.id = s.dossier_id
         LEFT JOIN users u ON u.id = s.decided_by
         ORDER BY s.id DESC LIMIT 300`,
      )
      .all() as Parameters<typeof mapDecision>[0][]
  ).map(mapDecision);
}

export function listSorties(actor: Actor): SecSortieDTO[] {
  requireSecurite(actor);
  const db = sessionsDb();
  const rows = db
    .prepare(
      `SELECT s.*, d.code AS dossier_code, o.code AS order_code,
              ua.nom || ' ' || ua.prenom AS authorized_by_name,
              uc.nom || ' ' || uc.prenom AS confirmed_by_name
       FROM sec_sorties s
       JOIN mg_dossiers d ON d.id = s.dossier_id
       JOIN mg_orders o ON o.id = d.order_id
       LEFT JOIN users ua ON ua.id = s.authorized_by
       LEFT JOIN users uc ON uc.id = s.confirmed_by
       ORDER BY s.id DESC LIMIT 300`,
    )
    .all() as Array<{
    id: number;
    code: string;
    dossier_id: number;
    dossier_code: string;
    order_code: string;
    status: SecSortieDTO['status'];
    authorized_by_name: string | null;
    authorized_at: string;
    authorized_reason: string | null;
    confirmed_by_name: string | null;
    confirmed_at: string | null;
    movement_logged: number;
  }>;
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    dossierCode: row.dossier_code,
    orderCode: row.order_code,
    status: row.status,
    authorizedByName: row.authorized_by_name,
    authorizedAt: row.authorized_at,
    authorizedReason: row.authorized_reason,
    confirmedByName: row.confirmed_by_name,
    confirmedAt: row.confirmed_at,
    movementLogged: row.movement_logged === 1,
    cartons: (
      db
        .prepare(
          `SELECT DISTINCT c.code, COALESCE(SUM(cl.qty), 0) AS total
           FROM mg_reservations r
           JOIN mg_dossiers d ON d.order_id = r.order_id AND d.id = ?
           JOIN st_cartons c ON c.id = r.carton_id
           LEFT JOIN st_carton_lines cl ON cl.carton_id = c.id
           WHERE r.status = 'active' GROUP BY c.id ORDER BY c.code`,
        )
        .all(row.dossier_id) as Array<{ code: string; total: number }>
    ).map((entry) => ({ code: entry.code, totalQty: entry.total })),
  }));
}

function recordDecision(
  db: import('better-sqlite3').Database,
  input: {
    dossierId: number;
    controlId: number | null;
    decision: SecDecision;
    reason: string | null;
    decidedBy: number;
  },
): void {
  db.prepare(
    `INSERT INTO sec_decisions (dossier_id, controle_id, decision, reason, decided_by)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(input.dossierId, input.controlId, input.decision, input.reason, input.decidedBy);
  db.prepare('UPDATE mg_dossiers SET security_result = ? WHERE id = ?').run(
    input.decision,
    input.dossierId,
  );
}

/**
 * Enregistre une décision sur un dossier contrôlé. Une autorisation
 * exige un contrôle conforme, aucune anomalie ouverte critique, aucune
 * sortie déjà autorisée. Toute décision est historisée.
 */
export function decide(actor: Actor, input: Record<string, unknown>): SecDecisionDTO {
  requireSecurite(actor);
  if (actor.id === null) throw new ServiceError('Session utilisateur invalide.', 401);
  const actorId = actor.id;
  const db = sessionsDb();
  const dossierId = requireId(input.dossierId, 'Dossier');
  const raw = String(input.decision ?? '');
  const allowed: SecDecision[] = [
    'conforme',
    'non_conforme',
    'attente_correction',
    'contrev_crequise',
    'autorisee',
    'refusee',
  ];
  if (!allowed.includes(raw as SecDecision)) {
    throw new ServiceError('Décision inconnue.', 400);
  }
  const decision = raw as SecDecision;
  const reason = normalizeText(input.reason, 400);
  const run = db.transaction((): number => {
    const dossier = db
      .prepare(`${DOSSIER_SELECT} WHERE d.id = ?`)
      .get(dossierId) as
      | { id: number; code: string; status: string; order_id: number; order_code: string; version: number }
      | undefined;
    if (!dossier) throw new ServiceError('Dossier introuvable.', 404);
    if (dossier.status !== 'soumis') {
      throw new ServiceError('Ce dossier n’est plus soumis : décision impossible.', 409);
    }
    const latest = db
      .prepare('SELECT MAX(id) AS id FROM mg_dossiers WHERE order_id = ?')
      .get(dossier.order_id) as { id: number };
    if (latest.id !== dossier.id) {
      throw new ServiceError(
        'Une version plus récente du dossier existe : décidez sur la dernière soumission.',
        409,
      );
    }
    const control = db
      .prepare(
        `SELECT id, status FROM sec_controles
         WHERE dossier_id = ? AND status IN ('conforme','non_conforme','attente_correction')
         ORDER BY id DESC LIMIT 1`,
      )
      .get(dossierId) as { id: number; status: string } | undefined;
    if (!control) {
      throw new ServiceError('Aucun contrôle clôturé pour ce dossier.', 409);
    }
    if (decision === 'autorisee') {
      const blocking = db
        .prepare(
          `SELECT COUNT(*) AS n FROM sec_anomalies
           WHERE dossier_id = ? AND status = 'ouverte' AND severity = 'critical'`,
        )
        .get(dossierId) as { n: number };
      if (blocking.n > 0) {
        raiseAlert(db, {
          category: 'SORTIE_NON_AUTORISEE_SEC',
          severity: 'critical',
          objectType: 'mg_dossier',
          objectId: dossierId,
          message: `Tentative d'autorisation de ${dossier.code} avec ${blocking.n} anomalie(s) critique(s) ouverte(s).`,
          ownerRole: 'chef_securite',
        });
        throw new ServiceError(
          `${blocking.n} anomalie(s) critique(s) ouverte(s) : sortie bloquée.`,
          409,
        );
      }
      if (control.status !== 'conforme') {
        throw new ServiceError(
          'Le contrôle n’est pas conforme : autorisation refusée.',
          409,
        );
      }
      const pending = db
        .prepare(
          `SELECT COUNT(*) AS n FROM sensitive_requests
           WHERE entity_type = 'sec_anomalie' AND status = 'en_attente'`,
        )
        .get() as { n: number };
      if (pending.n > 0) {
        throw new ServiceError(
          'Des contre-vérifications sont en attente : autorisation bloquée.',
          409,
        );
      }
      const existing = db
        .prepare(
          `SELECT id FROM sec_sorties WHERE dossier_id = ? AND status IN ('autorisee','confirmee')`,
        )
        .get(dossierId) as { id: number } | undefined;
      if (existing) {
        throw new ServiceError('Une sortie est déjà autorisée pour ce dossier.', 409);
      }
      const code = nextSecCode(db, 'sec_sorties', 'SOR-');
      db.prepare(
        `INSERT INTO sec_sorties (code, dossier_id, controle_id, authorized_by, authorized_reason)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(code, dossierId, control.id, actorId, reason);
      addSecHistory(db, {
        action: 'SORTIE_AUTORISEE',
        entityType: 'mg_dossier',
        entityId: dossierId,
        actorId,
        newValue: { code, controlId: control.id },
        reason,
      });
    }
    recordDecision(db, {
      dossierId,
      controlId: control.id,
      decision,
      reason,
      decidedBy: actorId,
    });
    addSecHistory(db, {
      action: 'DECISION_ENREGISTREE',
      entityType: 'mg_dossier',
      entityId: dossierId,
      actorId,
      newValue: { decision },
      reason,
    });
    if (decision === 'refusee' || decision === 'non_conforme') {
      raiseAlert(db, {
        category: 'SORTIE_REFUSEE_SEC',
        severity: 'warning',
        objectType: 'mg_dossier',
        objectId: dossierId,
        message: `Décision « ${decision} » sur ${dossier.code} : ${reason ?? 'sans motif précisé'}.`,
        ownerRole: 'chef_securite',
      });
    }
    const decisionRow = db
      .prepare(
        `SELECT id, dossier_id, decision, reason, decided_at FROM sec_decisions
         WHERE dossier_id = ? ORDER BY id DESC LIMIT 1`,
      )
      .get(dossierId) as { id: number; dossier_id: number; decision: SecDecision; reason: string | null; decided_at: string };
    return decisionRow.id;
  });
  const decisionId = run();
  const row = db
    .prepare(
      `SELECT s.id, s.dossier_id, d.code AS dossier_code, s.decision, s.reason,
              u.nom || ' ' || u.prenom AS decided_by_name, s.decided_at
       FROM sec_decisions s
       JOIN mg_dossiers d ON d.id = s.dossier_id
       LEFT JOIN users u ON u.id = s.decided_by
       WHERE s.id = ?`,
    )
    .get(decisionId) as Parameters<typeof mapDecision>[0];
  return mapDecision(row);
}
