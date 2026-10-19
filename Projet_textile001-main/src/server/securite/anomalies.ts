import type Database from 'better-sqlite3';
import { ServiceError } from '@/server/api/service-error';
import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import { raiseAlert } from '@/server/alerts/alerts';
import {
  approveSensitiveRequest,
  createSensitiveRequest,
  invalidateStaleRequests,
} from '@/server/approvals/approvals';
import type { SecAnomalyDTO } from '@/types/securite';
import {
  addSecHistory,
  nextSecCode,
  normalizeText,
  requireId,
  requireSecurite,
  requireText,
} from './common';
import { ANOMALY_SELECT, mapAnomaly } from './dossiers';

/**
 * Anomalies factuelles du contrôle de sortie. Une anomalie déclenche
 * une vérification, jamais une accusation. La résolution d'une
 * anomalie critique exige une contre-vérification (l'auteur de la
 * résolution ne peut pas l'approuver lui-même).
 */

export type SecAnomalyType =
  | 'carton_manquant'
  | 'carton_supplementaire'
  | 'carton_inconnu'
  | 'qr_invalide'
  | 'carton_double'
  | 'carton_deja_sorti'
  | 'reference_incoherente'
  | 'quantite_ecart'
  | 'dossier_modifie'
  | 'dossier_incomplet'
  | 'sortie_non_autorisee'
  | 'incoherence_stock'
  | 'echec_contre_verification';

/** Crée une anomalie (utilisé aussi par les autres services). */
export function createAnomaly(
  db: Database.Database,
  input: {
    dossierId: number | null;
    controleId: number | null;
    cartonId: number | null;
    type: SecAnomalyType;
    severity: 'info' | 'warning' | 'critical';
    description: string;
    detectedBy: number | null;
  },
): number {
  const code = nextSecCode(db, 'sec_anomalies', 'ANM-');
  const result = db
    .prepare(
      `INSERT INTO sec_anomalies
         (code, dossier_id, controle_id, carton_id, type, severity, description, detected_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      code,
      input.dossierId,
      input.controleId,
      input.cartonId,
      input.type,
      input.severity,
      input.description,
      input.detectedBy,
    );
  return Number(result.lastInsertRowid);
}

export function listAnomalies(actor: Actor): SecAnomalyDTO[] {
  requireSecurite(actor);
  const db = sessionsDb();
  return (
    db.prepare(`${ANOMALY_SELECT} ORDER BY a.id DESC LIMIT 400`).all() as Parameters<
      typeof mapAnomaly
    >[0][]
  ).map(mapAnomaly);
}

/**
 * Résout une anomalie. Critique → demande de contre-vérification en
 * attente : aucun effet définitif tant qu'une autre personne habilitée
 * n'a pas approuvé.
 */
export function resolveAnomaly(actor: Actor, input: Record<string, unknown>): {
  status: 'resolue' | 'contrev_crequise';
} {
  requireSecurite(actor);
  if (actor.id === null) throw new ServiceError('Session utilisateur invalide.', 401);
  const actorId = actor.id;
  const db = sessionsDb();
  const anomalyId = requireId(input.anomalyId, 'Anomalie');
  const reason = requireText(input.reason, 'Le motif de résolution', 400);
  const run = db.transaction((): { status: 'resolue' | 'contrev_crequise' } => {
    const anomaly = db
      .prepare('SELECT * FROM sec_anomalies WHERE id = ?')
      .get(anomalyId) as
      | { id: number; code: string; type: SecAnomalyType; severity: string; status: string }
      | undefined;
    if (!anomaly) throw new ServiceError('Anomalie introuvable.', 404);
    if (anomaly.status !== 'ouverte') {
      throw new ServiceError('Cette anomalie est déjà traitée.', 409);
    }
    invalidateStaleRequests(db, 'sec_anomalie', anomalyId, { reason, resolvedAt: null });
    if (anomaly.severity === 'critical') {
      createSensitiveRequest(db, {
        action: 'SEC_RESOUT_ANOMALIE_CRITIQUE',
        entityType: 'sec_anomalie',
        entityId: anomalyId,
        payload: { reason },
        reason,
        requestedBy: actorId,
      });
      addSecHistory(db, {
        action: 'CONTREVERIFICATION_DEMANDEE',
        entityType: 'sec_anomalie',
        entityId: anomalyId,
        actorId,
        newValue: { type: anomaly.type },
        reason,
      });
      raiseAlert(db, {
        category: 'CONTREVERIFICATION_SEC',
        severity: 'warning',
        objectType: 'sec_anomalie',
        objectId: anomalyId,
        message: `Anomalie critique ${anomaly.code} : contre-vérification requise.`,
        ownerRole: 'chef_securite',
      });
      return { status: 'contrev_crequise' };
    }
    db.prepare(
      `UPDATE sec_anomalies
       SET status = 'resolue', resolved_by = ?, resolved_at = datetime('now'),
           resolution = 'resolue', resolution_reason = ?
       WHERE id = ?`,
    ).run(actorId, reason, anomalyId);
    addSecHistory(db, {
      action: 'ANOMALIE_RESOLUE',
      entityType: 'sec_anomalie',
      entityId: anomalyId,
      actorId,
      oldValue: { status: 'ouverte' },
      newValue: { status: 'resolue' },
      reason,
    });
    return { status: 'resolue' };
  });
  return run();
}

/** Approuve la contre-vérification en attente d'une anomalie critique. */
export function approveCounterCheck(actor: Actor, input: Record<string, unknown>): void {
  requireSecurite(actor);
  if (actor.id === null) throw new ServiceError('Session utilisateur invalide.', 401);
  const db = sessionsDb();
  const requestId = requireId(input.requestId, 'Demande');
  const note = normalizeText(input.note, 300);
  approveSensitiveRequest(db, {
    requestId,
    approver: actor,
    allowedRoles: ['chef_securite'],
    note,
    apply: () => {
      const request = db
        .prepare('SELECT * FROM sensitive_requests WHERE id = ?')
        .get(requestId) as { entity_id: number; payload: string } | undefined;
      if (!request) throw new ServiceError('Demande introuvable.', 404);
      const payload = JSON.parse(request.payload) as { reason: string };
      db.prepare(
        `UPDATE sec_anomalies
         SET status = 'acceptee', resolved_by = ?, resolved_at = datetime('now'),
             resolution = 'contrev_approuvee', resolution_reason = ?
         WHERE id = ? AND status = 'ouverte'`,
      ).run(actor.id, payload.reason, request.entity_id);
      addSecHistory(db, {
        action: 'CONTREVERIFICATION_APPROUVEE',
        entityType: 'sec_anomalie',
        entityId: request.entity_id,
        actorId: actor.id,
        reason: note ?? payload.reason,
      });
    },
  });
}

/** Demande une correction au chef magasinier : la commande repart en « retour ». */
export function requestCorrection(actor: Actor, input: Record<string, unknown>): void {
  requireSecurite(actor);
  if (actor.id === null) throw new ServiceError('Session utilisateur invalide.', 401);
  const actorId = actor.id;
  const db = sessionsDb();
  const dossierId = requireId(input.dossierId, 'Dossier');
  const reason = requireText(input.reason, 'Le motif de correction', 400);
  const run = db.transaction((): void => {
    const dossier = db
      .prepare(
        `SELECT d.id, d.code, o.id AS order_id, o.status AS order_status, o.code AS order_code
         FROM mg_dossiers d JOIN mg_orders o ON o.id = d.order_id WHERE d.id = ?`,
      )
      .get(dossierId) as
      | { id: number; code: string; order_id: number; order_status: string; order_code: string }
      | undefined;
    if (!dossier) throw new ServiceError('Dossier introuvable.', 404);
    if (dossier.order_status !== 'soumis') {
      throw new ServiceError('Ce dossier n’est plus soumis : correction impossible.', 409);
    }
    const open = db
      .prepare(
        `SELECT COUNT(*) AS n FROM sec_anomalies
         WHERE dossier_id = ? AND status = 'ouverte'`,
      )
      .get(dossierId) as { n: number };
    if (open.n === 0) {
      throw new ServiceError('Aucune anomalie ouverte : rien à corriger.', 409);
    }
    db.prepare(`UPDATE mg_orders SET status = 'retour' WHERE id = ?`).run(dossier.order_id);
    addSecHistory(db, {
      action: 'CORRECTION_DEMANDEE',
      entityType: 'mg_dossier',
      entityId: dossierId,
      actorId,
      oldValue: { orderStatus: 'soumis' },
      newValue: { orderStatus: 'retour' },
      reason,
    });
    raiseAlert(db, {
      category: 'CORRECTION_DEMANDEE_SEC',
      severity: 'warning',
      objectType: 'mg_dossier',
      objectId: dossierId,
      message: `Correction demandée sur ${dossier.code} (commande ${dossier.order_code}) : ${reason}`,
      ownerRole: 'chef_magasinier',
    });
  });
  run();
}
