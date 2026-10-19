import { ServiceError } from '@/server/api/service-error';
import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import { raiseAlert } from '@/server/alerts/alerts';
import { recordSortieInternal } from '@/server/stock/movements';
import type { SecSortieDTO } from '@/types/securite';
import { addSecHistory, normalizeText, requireId, requireSecurite } from './common';
import { listSorties } from './decisions';

/**
 * Confirmation de la sortie physique. Distincte de l'autorisation :
 * le mouvement définitif de stock est enregistré UNE SEULE fois, dans
 * la même transaction que la confirmation, via le service interne du
 * module Stock (anti-double-déduction). En cas d'échec, tout est
 * annulé : aucune sortie confirmée sans mouvement de stock cohérent.
 */

export { listSorties };

interface ReservationRow {
  id: number;
  order_id: number;
  line_id: number;
  lot_id: number;
  size_id: number;
  carton_id: number;
  qty: number;
}

/** Confirme la sortie physique effective d'un dossier autorisé. */
export function confirmSortie(actor: Actor, input: Record<string, unknown>): SecSortieDTO {
  requireSecurite(actor);
  if (actor.id === null) throw new ServiceError('Session utilisateur invalide.', 401);
  const actorId = actor.id;
  const db = sessionsDb();
  const sortieId = requireId(input.sortieId, 'Sortie');
  const notes = normalizeText(input.notes, 400);
  const run = db.transaction((): void => {
    const sortie = db
      .prepare(
        `SELECT s.*, d.order_id, d.code AS dossier_code, d.status AS dossier_status
         FROM sec_sorties s JOIN mg_dossiers d ON d.id = s.dossier_id WHERE s.id = ?`,
      )
      .get(sortieId) as
      | {
          id: number;
          code: string;
          dossier_id: number;
          order_id: number;
          dossier_code: string;
          dossier_status: string;
          status: string;
          movement_logged: number;
          controle_id: number;
        }
      | undefined;
    if (!sortie) throw new ServiceError('Sortie introuvable.', 404);
    if (sortie.status === 'confirmee') {
      throw new ServiceError('Cette sortie a déjà été physiquement confirmée.', 409);
    }
    if (sortie.status !== 'autorisee') {
      throw new ServiceError(
        `Sortie en statut « ${sortie.status} » : confirmation impossible.`,
        409,
      );
    }
    if (sortie.dossier_status !== 'soumis') {
      throw new ServiceError(
        'Le dossier sous-jacent n’est plus soumis : vérifiez les données avant confirmation.',
        409,
      );
    }
    const latest = db
      .prepare('SELECT MAX(id) AS id FROM mg_dossiers WHERE order_id = ?')
      .get(sortie.order_id) as { id: number };
    if (latest.id !== sortie.dossier_id) {
      throw new ServiceError(
        'Le dossier a été remplacé par une version plus récente : autorisation invalide.',
        409,
      );
    }
    const blocking = db
      .prepare(
        `SELECT COUNT(*) AS n FROM sec_anomalies
         WHERE dossier_id = ? AND status = 'ouverte' AND severity = 'critical'`,
      )
      .get(sortie.dossier_id) as { n: number };
    if (blocking.n > 0) {
      throw new ServiceError(
        `${blocking.n} anomalie(s) critique(s) ouverte(s) : sortie bloquée.`,
        409,
      );
    }
    const reservations = db
      .prepare(
        `SELECT id, order_id, line_id, lot_id, size_id, carton_id, qty
         FROM mg_reservations WHERE order_id = ? AND status = 'active' ORDER BY id`,
      )
      .all(sortie.order_id) as ReservationRow[];
    if (reservations.length === 0) {
      raiseAlert(db, {
        category: 'INCOHERENCE_STOCK_SEC',
        severity: 'critical',
        objectType: 'sec_sortie',
        objectId: sortieId,
        message: `Aucune réservation active pour la sortie ${sortie.code} : incohérence stock.`,
        ownerRole: 'chef_securite',
      });
      throw new ServiceError(
        'Aucune réservation active : incohérence entre la préparation et le stock.',
        409,
      );
    }
    const reason = `Sortie physique ${sortie.code} (dossier ${sortie.dossier_code})`;
    for (const reservation of reservations) {
      recordSortieInternal(db, {
        lotId: reservation.lot_id,
        sizeId: reservation.size_id,
        qty: reservation.qty,
        cartonId: reservation.carton_id,
        reason,
        actorId,
      });
    }
    db.prepare(
      `UPDATE sec_sorties
       SET status = 'confirmee', confirmed_by = ?, confirmed_at = datetime('now'),
           movement_logged = 1, notes = ?
       WHERE id = ? AND status = 'autorisee'`,
    ).run(actorId, notes, sortieId);
    db.prepare(`UPDATE mg_dossiers SET security_result = 'confirmee' WHERE id = ?`).run(
      sortie.dossier_id,
    );
    addSecHistory(db, {
      action: 'SORTIE_CONFIRMEE',
      entityType: 'sec_sortie',
      entityId: sortieId,
      actorId,
      oldValue: { status: 'autorisee' },
      newValue: { status: 'confirmee', movements: reservations.length },
      reason: notes ?? reason,
    });
    raiseAlert(db, {
      category: 'SORTIE_CONFIRMEE_SEC',
      severity: 'info',
      objectType: 'sec_sortie',
      objectId: sortieId,
      message: `Sortie ${sortie.code} physiquement confirmée : ${reservations.length} réservation(s) convertie(s) en mouvement(s) de stock.`,
      ownerRole: 'chef_securite',
    });
  });
  run();
  const all = listSorties(actor);
  const sortie = all.find((item) => item.id === sortieId);
  if (!sortie) throw new ServiceError('Erreur interne : sortie introuvable après confirmation.', 500);
  return sortie;
}
