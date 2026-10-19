import { ServiceError } from '@/server/api/service-error';
import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import { raiseAlert } from '@/server/alerts/alerts';
import type { SecControlDTO, SecControlStatus } from '@/types/securite';
import {
  addSecHistory,
  normalizeText,
  parseCartonCode,
  requireId,
  requireSecurite,
  requireText,
} from './common';
import { createAnomaly } from './anomalies';
import { checkQuantities, checkReferences } from './detail-checks';
import { CONTROL_SELECT, mapControl, type ControlRow } from './control-map';

/**
 * Comptage physique et clôture du contrôle. Un carton n'est compté
 * qu'une fois par contrôle ; un scan ne contourne jamais les contrôles
 * serveur. Les écarts (manquant, inconnu, doublon, supplémentaire,
 * déjà sorti, quantités) sont calculés côté serveur.
 */

export interface ScanOutcome {
  result: 'attendu' | 'supplementaire' | 'doublon' | 'inconnu';
  message: string;
  expectedLeft: number;
}

/** Comptage d'un carton : scan QR (JO|CARTON|CODE) ou saisie manuelle. */
export function recordScan(actor: Actor, input: Record<string, unknown>): ScanOutcome {
  requireSecurite(actor);
  if (actor.id === null) throw new ServiceError('Session utilisateur invalide.', 401);
  const actorId = actor.id;
  const db = sessionsDb();
  const controlId = requireId(input.controleId, 'Contrôle');
  const parsed = parseCartonCode(requireText(input.code, 'Le code de carton', 120));
  const run = db.transaction((): ScanOutcome => {
    const control = db
      .prepare(
        `SELECT c.*, d.status AS dossier_status FROM sec_controles c
         JOIN mg_dossiers d ON d.id = c.dossier_id WHERE c.id = ?`,
      )
      .get(controlId) as
      | { id: number; dossier_id: number; status: string; dossier_status: string }
      | undefined;
    if (!control) throw new ServiceError('Contrôle introuvable.', 404);
    if (
      control.status !== 'en_cours' &&
      control.status !== 'attente_correction' &&
      control.status !== 'non_conforme'
    ) {
      throw new ServiceError('Ce contrôle n’accepte plus de comptage.', 409);
    }
    if (control.dossier_status !== 'soumis') {
      throw new ServiceError('Le dossier sous-jacent n’est plus soumis.', 409);
    }
    const carton = db
      .prepare(`SELECT id, code, status FROM st_cartons WHERE code = ?`)
      .get(parsed.code) as { id: number; code: string; status: string } | undefined;
    if (!carton) {
      createAnomaly(db, {
        dossierId: control.dossier_id,
        controleId: control.id,
        cartonId: null,
        type: parsed.fromQr ? 'qr_invalide' : 'carton_inconnu',
        severity: 'critical',
        description: `Carton « ${parsed.code} » introuvable${parsed.fromQr ? ' (QR illisible ou code inconnu)' : ' dans la base'} : carton présenté non attendu.`,
        detectedBy: actorId,
      });
      return {
        result: 'inconnu',
        message: 'Carton inconnu : anomalie créée, sortie bloquée.',
        expectedLeft: 0,
      };
    }
    const already = db
      .prepare('SELECT id FROM sec_observations WHERE controle_id = ? AND carton_id = ?')
      .get(control.id, carton.id) as { id: number } | undefined;
    if (already) {
      createAnomaly(db, {
        dossierId: control.dossier_id,
        controleId: control.id,
        cartonId: carton.id,
        type: 'carton_double',
        severity: 'warning',
        description: `Carton ${carton.code} présenté une seconde fois dans le même contrôle.`,
        detectedBy: actorId,
      });
      return {
        result: 'doublon',
        message: 'Doublon : ce carton est déjà compté.',
        expectedLeft: 0,
      };
    }
    const expected = db
      .prepare(
        `SELECT COUNT(*) AS n FROM mg_reservations r
         JOIN mg_dossiers d ON d.order_id = r.order_id AND d.id = ?
         WHERE r.carton_id = ? AND r.status = 'active'`,
      )
      .get(control.dossier_id, carton.id) as { n: number };
    const totalQty = (
      db
        .prepare('SELECT COALESCE(SUM(qty), 0) AS total FROM st_carton_lines WHERE carton_id = ?')
        .get(carton.id) as { total: number }
    ).total;
    const isExpected = expected.n > 0;
    db.prepare(
      `INSERT INTO sec_observations (controle_id, carton_id, code_saisi, result, qty_total, observed_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      control.id,
      carton.id,
      parsed.code,
      isExpected ? 'attendu' : 'supplementaire',
      totalQty,
      actorId,
    );
    const alreadyExited = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM st_movements WHERE carton_id = ? AND movement_type = 'sortie'`,
        )
        .get(carton.id) as { n: number }
    ).n;
    if (alreadyExited > 0) {
      createAnomaly(db, {
        dossierId: control.dossier_id,
        controleId: control.id,
        cartonId: carton.id,
        type: 'carton_deja_sorti',
        severity: 'critical',
        description: `Le carton ${carton.code} a déjà fait l'objet d'un mouvement de sortie.`,
        detectedBy: actorId,
      });
    }
    if (!isExpected) {
      createAnomaly(db, {
        dossierId: control.dossier_id,
        controleId: control.id,
        cartonId: carton.id,
        type: 'carton_supplementaire',
        severity: 'critical',
        description: `Carton ${carton.code} physiquement présent mais absent du dossier de sortie.`,
        detectedBy: actorId,
      });
      return {
        result: 'supplementaire',
        message: 'Carton supplémentaire : anomalie créée.',
        expectedLeft: 0,
      };
    }
    addSecHistory(db, {
      action: 'CARTON_COMPTE',
      entityType: 'sec_controle',
      entityId: control.id,
      actorId,
      newValue: { cartonCode: carton.code, fromQr: parsed.fromQr },
    });
    const left = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM mg_reservations r
           JOIN mg_dossiers d ON d.order_id = r.order_id AND d.id = ?
           WHERE r.status = 'active' AND r.carton_id NOT IN
             (SELECT carton_id FROM sec_observations WHERE controle_id = ?)`,
        )
        .get(control.dossier_id, control.id) as { n: number }
    ).n;
    return {
      result: 'attendu',
      message: `Carton ${carton.code} compté (${totalQty} pièce(s) déclarées).`,
      expectedLeft: left,
    };
  });
  return run();
}

/** Niveau 3 : quantités réellement vérifiées par ligne de commande. */
export function recordLineCheck(actor: Actor, input: Record<string, unknown>): void {
  requireSecurite(actor);
  if (actor.id === null) throw new ServiceError('Session utilisateur invalide.', 401);
  const actorId = actor.id;
  const db = sessionsDb();
  const controlId = requireId(input.controleId, 'Contrôle');
  const orderLineId = requireId(input.orderLineId, 'Ligne de commande');
  const qtyChecked = Number(String(input.qtyChecked ?? '').replace(',', '.'));
  if (!Number.isFinite(qtyChecked) || qtyChecked < 0) {
    throw new ServiceError('Quantité vérifiée invalide.', 400);
  }
  const run = db.transaction((): void => {
    const control = db
      .prepare('SELECT id, status, level FROM sec_controles WHERE id = ?')
      .get(controlId) as { id: number; status: string; level: string } | undefined;
    if (!control) throw new ServiceError('Contrôle introuvable.', 404);
    if (
      control.status !== 'en_cours' &&
      control.status !== 'attente_correction' &&
      control.status !== 'non_conforme'
    ) {
      throw new ServiceError('Ce contrôle n’accepte plus de vérification.', 409);
    }
    if (control.level !== 'quantites') {
      throw new ServiceError('Le contrôle détaillé des quantités n’est pas activé.', 409);
    }
    const line = db
      .prepare(
        `SELECT l.id FROM mg_order_lines l
         JOIN mg_dossiers d ON d.order_id = l.order_id
         JOIN sec_controles c ON c.dossier_id = d.id
         WHERE l.id = ? AND c.id = ?`,
      )
      .get(orderLineId, controlId) as { id: number } | undefined;
    if (!line) {
      throw new ServiceError('Cette ligne n’appartient pas au dossier contrôlé.', 400);
    }
    db.prepare(
      `INSERT INTO sec_line_checks (controle_id, order_line_id, qty_checked, checked_by)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (controle_id, order_line_id)
       DO UPDATE SET qty_checked = excluded.qty_checked, checked_by = excluded.checked_by`,
    ).run(controlId, orderLineId, qtyChecked, actorId);
    addSecHistory(db, {
      action: 'QUANTITE_VERIFIEE',
      entityType: 'sec_controle',
      entityId: controlId,
      actorId,
      newValue: { orderLineId, qtyChecked },
    });
  });
  run();
}

/** Clôture du contrôle : écarts calculés côté serveur, jamais déclarés. */
export function finishControl(actor: Actor, input: Record<string, unknown>): SecControlDTO {
  requireSecurite(actor);
  if (actor.id === null) throw new ServiceError('Session utilisateur invalide.', 401);
  const actorId = actor.id;
  const db = sessionsDb();
  const controlId = requireId(input.controleId, 'Contrôle');
  const notes = normalizeText(input.notes, 500);
  const run = db.transaction((): SecControlStatus => {
    const control = db
      .prepare('SELECT id, code, dossier_id, level, status FROM sec_controles WHERE id = ?')
      .get(controlId) as
      | { id: number; code: string; dossier_id: number; level: string; status: string }
      | undefined;
    if (!control) throw new ServiceError('Contrôle introuvable.', 404);
    if (
      control.status !== 'en_cours' &&
      control.status !== 'non_conforme' &&
      control.status !== 'attente_correction'
    ) {
      throw new ServiceError('Ce contrôle est déjà clôturé définitivement.', 409);
    }
    // Recomputation : les écarts auto-détectés précédemment sont
    // re-calculés à chaque clôture (historisé), puis recréés si
    // toujours pertinents. Les anomalies de scan ne sont jamais
    // effacées.
    db.prepare(
      `UPDATE sec_anomalies
       SET status = 'resolue', resolved_by = ?, resolved_at = datetime('now'),
           resolution = 'recalcul', resolution_reason = 'Recalculé lors de la clôture du contrôle'
       WHERE controle_id = ? AND status = 'ouverte'
         AND type IN ('carton_manquant','quantite_ecart','reference_incoherente')`,
    ).run(actorId, control.id);
    const expected = db
      .prepare(
        `SELECT DISTINCT c.id, c.code FROM mg_reservations r
         JOIN mg_dossiers d ON d.order_id = r.order_id AND d.id = ?
         JOIN st_cartons c ON c.id = r.carton_id
         WHERE r.status = 'active' ORDER BY c.code`,
      )
      .all(control.dossier_id) as Array<{ id: number; code: string }>;
    const observed = (
      db
        .prepare('SELECT carton_id FROM sec_observations WHERE controle_id = ? AND result = ?')
        .all(control.id, 'attendu') as Array<{ carton_id: number }>
    ).map((row) => row.carton_id);
    for (const carton of expected) {
      if (!observed.includes(carton.id)) {
        createAnomaly(db, {
          dossierId: control.dossier_id,
          controleId: control.id,
          cartonId: carton.id,
          type: 'carton_manquant',
          severity: 'critical',
          description: `Carton attendu ${carton.code} non présenté au contrôle.`,
          detectedBy: actorId,
        });
      }
    }
    if (control.level === 'references') {
      checkReferences(db, control.id, control.dossier_id, actorId);
    }
    if (control.level === 'quantites') {
      checkQuantities(db, control.id, control.dossier_id, actorId);
    }
    const blocking = db
      .prepare(
        `SELECT COUNT(*) AS n FROM sec_anomalies
         WHERE controle_id = ? AND status = 'ouverte' AND severity = 'critical'`,
      )
      .get(control.id) as { n: number };
    const anyOpen = db
      .prepare(
        `SELECT COUNT(*) AS n FROM sec_anomalies WHERE controle_id = ? AND status = 'ouverte'`,
      )
      .get(control.id) as { n: number };
    const status: SecControlStatus =
      blocking.n > 0 ? 'non_conforme' : anyOpen.n > 0 ? 'attente_correction' : 'conforme';
    db.prepare(
      `UPDATE sec_controles SET status = ?, notes = ?, finished_at = datetime('now') WHERE id = ?`,
    ).run(status, notes, control.id);
    addSecHistory(db, {
      action: 'CONTROLE_CLOTURE',
      entityType: 'sec_controle',
      entityId: control.id,
      actorId,
      oldValue: { status: 'en_cours' },
      newValue: { status, anomalies: anyOpen.n },
      reason: notes,
    });
    if (status !== 'conforme') {
      raiseAlert(db, {
        category: 'ANOMALIE_BLOQUANTE_SEC',
        severity: 'warning',
        objectType: 'sec_controle',
        objectId: control.id,
        message: `Contrôle ${control.code} : ${anyOpen.n} anomalie(s) ouverte(s) (${status}).`,
        ownerRole: 'chef_securite',
      });
    }
    return status;
  });
  run();
  const row = db.prepare(`${CONTROL_SELECT} WHERE c.id = ?`).get(controlId) as ControlRow;
  return mapControl(db, row);
}
