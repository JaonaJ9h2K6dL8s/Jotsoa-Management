import { ServiceError } from '@/server/api/service-error';
import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import { raiseAlert } from '@/server/alerts/alerts';
import type { SecControlDTO } from '@/types/securite';
import { addSecHistory, nextSecCode, requireId, requireSecurite, resolveLevel } from './common';
import { createAnomaly } from './anomalies';
import { CONTROL_SELECT, mapControl, type ControlRow } from './control-map';

/**
 * Démarrage et file des contrôles de sécurité. Un contrôle ne peut
 * démarrer que sur un dossier réellement soumis, dans sa dernière
 * version, sans sortie confirmée et sans contrôle actif incompatible.
 */

/** Invalide les contrôles obsolètes (dossier remplacé ou modifié). */
function invalidateStaleControls(
  db: import('better-sqlite3').Database,
  orderId: number,
): void {
  const stale = db
    .prepare(
      `SELECT c.id, d.id AS dossier_id
       FROM sec_controles c
       JOIN mg_dossiers d ON d.id = c.dossier_id
       WHERE d.order_id = ?
         AND c.status IN ('en_cours','conforme','non_conforme','attente_correction')
         AND (d.status != 'soumis'
              OR d.id != (SELECT MAX(id) FROM mg_dossiers WHERE order_id = ?))`,
    )
    .all(orderId, orderId) as Array<{ id: number; dossier_id: number }>;
  for (const row of stale) {
    db.prepare(
      `UPDATE sec_controles SET status = 'invalide', finished_at = datetime('now') WHERE id = ?`,
    ).run(row.id);
    addSecHistory(db, {
      action: 'CONTROLE_INVALIDE',
      entityType: 'sec_controle',
      entityId: row.id,
      actorId: null,
      newValue: { reason: 'dossier_modifie' },
    });
    createAnomaly(db, {
      dossierId: row.dossier_id,
      controleId: row.id,
      cartonId: null,
      type: 'dossier_modifie',
      severity: 'warning',
      description: 'Dossier modifié après soumission : contrôle invalidé, reprise nécessaire.',
      detectedBy: null,
    });
  }
}

export function listControls(actor: Actor): SecControlDTO[] {
  requireSecurite(actor);
  const db = sessionsDb();
  return (
    db.prepare(`${CONTROL_SELECT} ORDER BY c.id DESC LIMIT 200`).all() as ControlRow[]
  ).map((row) => mapControl(db, row));
}

/** Démarre un contrôle : dossier soumis, dernière version, pas de doublon. */
export function startControl(actor: Actor, input: Record<string, unknown>): SecControlDTO {
  requireSecurite(actor);
  if (actor.id === null) throw new ServiceError('Session utilisateur invalide.', 401);
  const actorId = actor.id;
  const db = sessionsDb();
  const dossierId = requireId(input.dossierId, 'Dossier');
  const run = db.transaction((): number => {
    const dossier = db
      .prepare(
        `SELECT d.id, d.code, d.status, d.version, o.id AS order_id, o.status AS order_status
         FROM mg_dossiers d JOIN mg_orders o ON o.id = d.order_id WHERE d.id = ?`,
      )
      .get(dossierId) as
      | { id: number; code: string; status: string; version: number; order_id: number; order_status: string }
      | undefined;
    if (!dossier) throw new ServiceError('Dossier introuvable.', 404);
    if (dossier.status !== 'soumis' || dossier.order_status !== 'soumis') {
      throw new ServiceError(
        'Ce dossier n’est pas soumis (retourné, annulé ou déjà traité).',
        409,
      );
    }
    const latest = db
      .prepare('SELECT MAX(id) AS id FROM mg_dossiers WHERE order_id = ?')
      .get(dossier.order_id) as { id: number };
    if (latest.id !== dossier.id) {
      throw new ServiceError(
        'Une version plus récente de ce dossier existe : utilisez la dernière soumission.',
        409,
      );
    }
    const confirmed = db
      .prepare(
        `SELECT COUNT(*) AS n FROM sec_sorties s
         JOIN mg_dossiers d ON d.id = s.dossier_id
         WHERE d.order_id = ? AND s.status = 'confirmee'`,
      )
      .get(dossier.order_id) as { n: number };
    if (confirmed.n > 0) {
      throw new ServiceError(
        'Une sortie de cette commande a déjà été physiquement confirmée.',
        409,
      );
    }
    invalidateStaleControls(db, dossier.order_id);
    const active = db
      .prepare(
        `SELECT COUNT(*) AS n FROM sec_controles WHERE dossier_id = ? AND status = 'en_cours'`,
      )
      .get(dossierId) as { n: number };
    if (active.n > 0) {
      throw new ServiceError('Un contrôle est déjà en cours pour ce dossier.', 409);
    }
    const level = resolveLevel(db, input.level);
    const code = nextSecCode(db, 'sec_controles', 'SEC-');
    const result = db
      .prepare(
        `INSERT INTO sec_controles (code, dossier_id, version, level, started_by)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(code, dossierId, dossier.version, level, actorId);
    const controlId = Number(result.lastInsertRowid);
    addSecHistory(db, {
      action: 'CONTROLE_DEMARRE',
      entityType: 'sec_controle',
      entityId: controlId,
      actorId,
      newValue: { code, dossierCode: dossier.code, level },
    });
    raiseAlert(db, {
      category: 'CONTROLE_SEC_EN_COURS',
      severity: 'info',
      objectType: 'sec_controle',
      objectId: controlId,
      message: `Contrôle ${code} démarré sur le dossier ${dossier.code}.`,
      ownerRole: 'chef_securite',
    });
    return controlId;
  });
  const controlId = run();
  const row = db.prepare(`${CONTROL_SELECT} WHERE c.id = ?`).get(controlId) as ControlRow;
  return mapControl(db, row);
}
