import { ServiceError } from '@/server/api/service-error';
import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import { raiseAlert } from '@/server/alerts/alerts';
import type { MgCheckDTO, MgDossierDTO, MgOrderLineDTO } from '@/types/magasinier';
import {
  addMgHistory,
  nextMgCode,
  normalizeText,
  requireId,
  requireMagasinier,
} from './common';

/**
 * Vérification de la préparation puis dossier de sortie soumis au
 * Chef Sécurité. La transmission ne signifie pas que les cartons ont
 * quitté l'usine : les champs security_* restent à l'étape 10. Le chef
 * magasinier ne peut jamais valider le comptage indépendant.
 */

interface DossierRow {
  id: number;
  code: string;
  order_id: number;
  order_code: string;
  external_order_no: string | null;
  version: number;
  status: 'soumis' | 'retour' | 'annule';
  notes: string | null;
  submitted_by_name: string | null;
  submitted_at: string;
}

function linesOfDossier(
  db: import('better-sqlite3').Database,
  orderId: number,
): MgOrderLineDTO[] {
  const rows = db
    .prepare(
      `SELECT l.id, l.product_id, p.nom AS product_nom, l.color_id, c.nom AS color_nom,
              l.size_id, s.nom AS size_nom, l.raw_text, l.qty_ordered, l.qty_prepared,
              l.match_status, l.notes
       FROM mg_order_lines l
       LEFT JOIN products p ON p.id = l.product_id
       LEFT JOIN colors c ON c.id = l.color_id
       LEFT JOIN sizes s ON s.id = l.size_id
       WHERE l.order_id = ? ORDER BY l.id`,
    )
    .all(orderId) as Array<{
    id: number;
    product_id: number | null;
    product_nom: string | null;
    color_id: number | null;
    color_nom: string | null;
    size_id: number | null;
    size_nom: string | null;
    raw_text: string | null;
    qty_ordered: number;
    qty_prepared: number;
    match_status: string;
    notes: string | null;
  }>;
  return rows.map((row) => ({
    id: row.id,
    productId: row.product_id,
    productNom: row.product_nom,
    colorId: row.color_id,
    colorNom: row.color_nom,
    sizeId: row.size_id,
    sizeNom: row.size_nom,
    rawText: row.raw_text,
    qtyOrdered: row.qty_ordered,
    qtyPrepared: row.qty_prepared,
    matchStatus: row.match_status as MgOrderLineDTO['matchStatus'],
    notes: row.notes,
    reservableQty: 0,
    preparedQty: row.qty_prepared,
  }));
}

function checksOf(db: import('better-sqlite3').Database, orderId: number): MgCheckDTO[] {
  return (
    db
      .prepare(
        `SELECT ck.id, o.code AS order_code, ck.result, ck.gaps, ck.notes,
                u.nom || ' ' || u.prenom AS checked_by_name, ck.checked_at
         FROM mg_checks ck
         JOIN mg_orders o ON o.id = ck.order_id
         LEFT JOIN users u ON u.id = ck.checked_by
         WHERE ck.order_id = ? ORDER BY ck.id DESC`,
      )
      .all(orderId) as MgCheckDTO[]
  ).map((row) => ({
    id: row.id,
    orderCode: row.orderCode,
    result: row.result,
    gaps: row.gaps,
    notes: row.notes,
    checkedByName: row.checkedByName,
    checkedAt: row.checkedAt,
  }));
}

function mapDossier(db: import('better-sqlite3').Database, row: DossierRow): MgDossierDTO {
  const cartons = (
    db
      .prepare(
        `SELECT DISTINCT c.code, COALESCE(SUM(cl.qty), 0) AS total
         FROM mg_reservations r
         JOIN st_cartons c ON c.id = r.carton_id
         LEFT JOIN st_carton_lines cl ON cl.carton_id = c.id
         WHERE r.order_id = ? AND r.status = 'active'
         GROUP BY c.id ORDER BY c.code`,
      )
      .all(row.order_id) as Array<{ code: string; total: number }>
  ).map((entry) => ({ code: entry.code, totalQty: entry.total }));
  return {
    id: row.id,
    code: row.code,
    orderCode: row.order_code,
    externalOrderNo: row.external_order_no,
    version: row.version,
    status: row.status,
    notes: row.notes,
    submittedByName: row.submitted_by_name,
    submittedAt: row.submitted_at,
    cartons,
    lines: linesOfDossier(db, row.order_id),
    checks: checksOf(db, row.order_id),
  };
}

const DOSSIER_SELECT = `
  SELECT d.*, o.code AS order_code, o.external_order_no,
         u.nom || ' ' || u.prenom AS submitted_by_name
  FROM mg_dossiers d
  JOIN mg_orders o ON o.id = d.order_id
  LEFT JOIN users u ON u.id = d.submitted_by`;

export function listDossiers(actor: Actor): MgDossierDTO[] {
  requireMagasinier(actor);
  const db = sessionsDb();
  return (
    db.prepare(`${DOSSIER_SELECT} ORDER BY d.id DESC LIMIT 300`).all() as DossierRow[]
  ).map((row) => mapDossier(db, row));
}

/** Vérification : écarts calculés côté serveur, jamais déclaratifs. */
export function verifyPreparation(
  actor: Actor,
  input: Record<string, unknown>,
): { result: 'conforme' | 'partielle'; gaps: string[] } {
  requireMagasinier(actor);
  if (actor.id === null) throw new ServiceError('Session utilisateur invalide.', 401);
  const actorId = actor.id;
  const db = sessionsDb();
  const orderId = requireId(input.orderId, 'Commande');
  const notes = normalizeText(input.notes, 300);
  const run = db.transaction((): { result: 'conforme' | 'partielle'; gaps: string[] } => {
    const order = db
      .prepare('SELECT id, code, status FROM mg_orders WHERE id = ?')
      .get(orderId) as { id: number; code: string; status: string } | undefined;
    if (!order) throw new ServiceError('Commande introuvable.', 404);
    if (order.status !== 'partielle' && order.status !== 'complete' && order.status !== 'en_preparation') {
      throw new ServiceError(
        `Vérification impossible : statut ${order.status}. Préparez d'abord les lignes.`,
        409,
      );
    }
    const unknown = db
      .prepare(
        `SELECT COUNT(*) AS n FROM mg_order_lines WHERE order_id = ? AND match_status != 'reconnu'`,
      )
      .get(orderId) as { n: number };
    if (unknown.n > 0) {
      throw new ServiceError(
        'Des lignes ne sont pas associées au catalogue : vérification refusée.',
        409,
      );
    }
    const lines = db
      .prepare(
        `SELECT l.id, l.qty_ordered, l.qty_prepared, l.qty_prepared AS prepared
         FROM mg_order_lines l WHERE l.order_id = ?`,
      )
      .all(orderId) as Array<{ id: number; qty_ordered: number; qty_prepared: number }>;
    const gaps: string[] = [];
    let orderedTotal = 0;
    let preparedTotal = 0;
    for (const line of lines) {
      orderedTotal += line.qty_ordered;
      preparedTotal += line.qty_prepared;
      if (line.qty_prepared < line.qty_ordered) {
        gaps.push(
          `Ligne #${line.id} : ${line.qty_ordered - line.qty_prepared} pièce(s) manquante(s).`,
        );
      }
      if (line.qty_prepared > line.qty_ordered) {
        gaps.push(
          `Ligne #${line.id} : ${line.qty_prepared - line.qty_ordered} pièce(s) excédentaire(s).`,
        );
      }
    }
    const stale = db
      .prepare(
        `SELECT COUNT(*) AS n FROM mg_reservations r
         JOIN mg_order_lines l ON l.id = r.line_id
         WHERE r.order_id = ? AND r.status = 'active'
           AND r.qty > (l.qty_ordered - l.qty_prepared + r.qty)`,
      )
      .get(orderId) as { n: number };
    if (stale.n > 0) {
      gaps.push('Réservations incohérentes détectées : à corriger avant soumission.');
    }
    const result = preparedTotal >= orderedTotal ? 'conforme' : 'partielle';
    db.prepare(
      `INSERT INTO mg_checks (order_id, result, gaps, notes, checked_by)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(orderId, result, gaps.length > 0 ? JSON.stringify(gaps) : null, notes, actorId);
    db.prepare(
      `UPDATE mg_orders SET status = ? WHERE id = ? AND status = 'en_preparation'`,
    ).run(result === 'conforme' ? 'complete' : 'partielle', orderId);
    addMgHistory(db, {
      action: 'PREPARATION_VERIFIEE',
      entityType: 'mg_order',
      entityId: orderId,
      actorId,
      newValue: { result, gaps: gaps.length },
    });
    return { result, gaps };
  });
  return run();
}

/** Soumission du dossier au Chef Sécurité : une version active par commande. */
export function submitDossier(actor: Actor, input: Record<string, unknown>): MgDossierDTO {
  requireMagasinier(actor);
  if (actor.id === null) throw new ServiceError('Session utilisateur invalide.', 401);
  const actorId = actor.id;
  const db = sessionsDb();
  const orderId = requireId(input.orderId, 'Commande');
  const notes = normalizeText(input.notes, 300);
  const run = db.transaction((): number => {
    const order = db
      .prepare('SELECT id, code, status FROM mg_orders WHERE id = ?')
      .get(orderId) as { id: number; code: string; status: string } | undefined;
    if (!order) throw new ServiceError('Commande introuvable.', 404);
    if (order.status === 'soumis') {
      throw new ServiceError('Le dossier de cette commande est déjà soumis.', 409);
    }
    if (order.status === 'annule') {
      throw new ServiceError('Une commande annulée ne peut pas être soumise.', 409);
    }
    if (order.status === 'a_verifier' || order.status === 'valide' || order.status === 'en_preparation') {
      throw new ServiceError(
        'Vérifiez d’abord la préparation avant de soumettre le dossier.',
        409,
      );
    }
    const lastCheck = db
      .prepare('SELECT result, checked_at FROM mg_checks WHERE order_id = ? ORDER BY id DESC LIMIT 1')
      .get(orderId) as { result: string; checked_at: string } | undefined;
    if (!lastCheck) {
      throw new ServiceError('Aucune vérification enregistrée pour cette commande.', 409);
    }
    const totals = db
      .prepare(
        `SELECT COALESCE(SUM(qty_ordered), 0) AS ordered,
                COALESCE(SUM(qty_prepared), 0) AS prepared
         FROM mg_order_lines WHERE order_id = ?`,
      )
      .get(orderId) as { ordered: number; prepared: number };
    const activeReservations = db
      .prepare(
        `SELECT COUNT(*) AS n FROM mg_reservations WHERE order_id = ? AND status = 'active'`,
      )
      .get(orderId) as { n: number };
    if (activeReservations.n === 0) {
      throw new ServiceError(
        'Aucun carton réservé : la soumission exige au moins un carton préparé.',
        409,
      );
    }
    const isPartial = totals.prepared < totals.ordered;
    if (isPartial && lastCheck.result !== 'partielle') {
      throw new ServiceError(
        'Préparation incomplète : refaites une vérification pour l’accepter explicitement.',
        409,
      );
    }
    if (isPartial) {
      raiseAlert(db, {
        category: 'SORTIE_PARTIELLE_MG',
        severity: 'warning',
        objectType: 'mg_order',
        objectId: orderId,
        message: `Sortie partielle soumise pour ${order.code} : ${totals.ordered - totals.prepared} pièce(s) manquante(s).`,
        ownerRole: 'chef_securite',
      });
    }
    const previous = db
      .prepare(
        `SELECT id, version FROM mg_dossiers
         WHERE order_id = ? AND status = 'soumis' ORDER BY id DESC LIMIT 1`,
      )
      .get(orderId) as { id: number; version: number } | undefined;
    if (previous) {
      db.prepare(`UPDATE mg_dossiers SET status = 'annule' WHERE id = ?`).run(previous.id);
    }
    const version = previous ? previous.version + 1 : 1;
    const code = nextMgCode(db, 'mg_dossiers', 'DOS-');
    const result = db
      .prepare(
        `INSERT INTO mg_dossiers (code, order_id, version, notes, submitted_by)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(code, orderId, version, notes, actorId);
    const dossierId = Number(result.lastInsertRowid);
    db.prepare(`UPDATE mg_orders SET status = 'soumis' WHERE id = ?`).run(orderId);
    addMgHistory(db, {
      action: 'DOSSIER_SOUMIS',
      entityType: 'mg_dossier',
      entityId: dossierId,
      actorId,
      oldValue: { status: order.status },
      newValue: { code, version, orderId, partial: isPartial },
    });
    raiseAlert(db, {
      category: 'DOSSIER_A_VERIFIER_SEC',
      severity: 'info',
      objectType: 'mg_dossier',
      objectId: dossierId,
      message: `Dossier de sortie ${code} (commande ${order.code}) soumis par le chef magasinier.`,
      ownerRole: 'chef_securite',
    });
    return dossierId;
  });
  const dossierId = run();
  const row = db.prepare(`${DOSSIER_SELECT} WHERE d.id = ?`).get(dossierId) as DossierRow;
  return mapDossier(db, row);
}

/** Retour pour correction : déclenché à l'étape 10, exposé pour l'historique. */
export function ordersNeedingAttention(actor: Actor): number {
  requireMagasinier(actor);
  const db = sessionsDb();
  const rows = db
    .prepare(
      `SELECT COUNT(*) AS n FROM mg_orders WHERE status = 'retour'`,
    )
    .get() as { n: number };
  return rows.n;
}

/**
 * Reprise d'une commande retournée par le Chef Sécurité : la
 * préparation repasse « en préparation » pour ajustement, puis
 * re-vérification et nouvelle soumission (nouvelle version de dossier).
 */
export function resumeAfterCorrection(actor: Actor, input: Record<string, unknown>): void {
  requireMagasinier(actor);
  if (actor.id === null) throw new ServiceError('Session utilisateur invalide.', 401);
  const actorId = actor.id;
  const db = sessionsDb();
  const orderId = requireId(input.orderId, 'Commande');
  const run = db.transaction((): void => {
    const order = db
      .prepare('SELECT id, code, status FROM mg_orders WHERE id = ?')
      .get(orderId) as { id: number; code: string; status: string } | undefined;
    if (!order) throw new ServiceError('Commande introuvable.', 404);
    if (order.status !== 'retour') {
      throw new ServiceError(
        `Seule une commande retournée peut être reprise (statut : ${order.status}).`,
        409,
      );
    }
    db.prepare(`UPDATE mg_orders SET status = 'en_preparation' WHERE id = ?`).run(orderId);
    addMgHistory(db, {
      action: 'COMMANDE_REPRISE',
      entityType: 'mg_order',
      entityId: orderId,
      actorId,
      oldValue: { status: 'retour' },
      newValue: { status: 'en_preparation' },
      reason: normalizeText(input.reason, 300) ?? 'Reprise après demande de correction.',
    });
  });
  run();
}
