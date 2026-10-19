import QRCode from 'qrcode';
import { sessionsDb } from '@/server/auth/sessions';
import { ServiceError } from '@/server/api/service-error';
import type { Actor } from '@/server/users/users-service';
import { addHistory, nextCode, normalizeText, requireCoupe, requireId } from './common';

/**
 * Tickets de production avec QR code (cahier §20) : coupe, transfert
 * vers la couture, suivi. Le QR contient un minimum d'informations
 * (code, type, référence d'opération, version) — jamais de donnée
 * confidentielle ; la consultation passe par l'API locale.
 */

export type TicketType = 'coupe' | 'transfert' | 'suivi';

export interface TicketDetail {
  id: number;
  code: string;
  type: TicketType;
  lotId: number | null;
  lotCode: string | null;
  planId: number | null;
  refOperation: string | null;
  payload: Record<string, unknown>;
  status: 'actif' | 'annule';
  reprintCount: number;
  lastReprintAt: string | null;
  lastReprintByName: string | null;
  observations: string | null;
  qrDataUrl: string;
  qrJson: string;
  createdByName: string | null;
  createdAt: string;
}

const SELECT_TICKET = `
  SELECT t.*, l.code AS lot_code,
         u.nom || ' ' || u.prenom AS author_name,
         ru.nom || ' ' || ru.prenom AS reprint_name
  FROM production_tickets t
  LEFT JOIN coupe_lots l ON l.id = t.lot_id
  JOIN users u ON u.id = t.created_by
  LEFT JOIN users ru ON ru.id = t.last_reprint_by
`;

function mapTicket(row: Record<string, unknown> & { id: number }): TicketDetail {
  const qrJson = String(row.qr_json ?? '{}');
  return {
    id: Number(row.id),
    code: String(row.code),
    type: row.type as TicketType,
    lotId: row.lot_id == null ? null : Number(row.lot_id),
    lotCode: (row.lot_code as string | null) ?? null,
    planId: row.plan_id == null ? null : Number(row.plan_id),
    refOperation: (row.ref_operation as string | null) ?? null,
    payload: JSON.parse(String(row.payload_json ?? '{}')) as Record<string, unknown>,
    status: row.status as TicketDetail['status'],
    reprintCount: Number(row.reprint_count ?? 0),
    lastReprintAt: (row.last_reprint_at as string | null) ?? null,
    lastReprintByName: (row.reprint_name as string | null) ?? null,
    observations: (row.observations as string | null) ?? null,
    // Généré à la demande, contrasté, sans dépendance réseau (§20.C).
    qrDataUrl: '',
    qrJson,
    createdByName: (row.author_name as string | null) ?? null,
    createdAt: String(row.created_at ?? ''),
  };
}

async function withQr(ticket: TicketDetail): Promise<TicketDetail> {
  ticket.qrDataUrl = await QRCode.toDataURL(ticket.qrJson, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 220,
  });
  return ticket;
}

export interface TicketInput {
  type: unknown;
  lotId?: unknown;
  planId?: unknown;
  refOperation?: unknown;
  observations?: unknown;
  payload?: unknown;
}

export async function createTicket(actor: Actor, body: TicketInput): Promise<TicketDetail> {
  return withQr(storeTicket(actor, body));
}

export function storeTicket(actor: Actor, body: TicketInput): TicketDetail {
  requireCoupe(actor);
  return sessionsDb().transaction(() => storeTicketData(actor, body)).immediate();
}

function storeTicketData(actor: Actor, body: TicketInput): TicketDetail {
  requireCoupe(actor);
  const db = sessionsDb();
  const type = String(body.type ?? '');
  if (!['coupe', 'transfert', 'suivi'].includes(type)) {
    throw new ServiceError('Type de ticket invalide (coupe, transfert ou suivi).', 400);
  }
  const lotId =
    body.lotId === null || body.lotId === undefined || body.lotId === ''
      ? null
      : requireId(body.lotId, 'Lot');
  if (lotId) {
    const lot = db.prepare('SELECT id FROM coupe_lots WHERE id = ?').get(lotId);
    if (!lot) throw new ServiceError('Lot introuvable.', 400);
  }
  const planId =
    body.planId === null || body.planId === undefined || body.planId === ''
      ? null
      : requireId(body.planId, 'Plan de marker');
  const refOperation = normalizeText(body.refOperation, 80);
  if (!lotId && !refOperation) {
    throw new ServiceError(
      'Un ticket doit être rattaché à un lot de coupe ou à une référence d’opération.',
      400,
    );
  }

  const code = nextCode(db, 'production_tickets', 'TICK-');
  const qrJson = JSON.stringify({
    t: code,
    k: type,
    r: refOperation ?? (lotId ? `LOT-${lotId}` : null),
    v: 1,
  });

  const info = db
    .prepare(
      `INSERT INTO production_tickets
         (code, type, lot_id, plan_id, ref_operation, payload_json, qr_json,
          observations, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      code,
      type,
      lotId,
      planId,
      refOperation,
      JSON.stringify(body.payload ?? {}),
      qrJson,
      normalizeText(body.observations, 500),
      actor.id,
    );
  const ticketId = Number(info.lastInsertRowid);
  addHistory(db, {
    action: 'create',
    entityType: 'production_ticket',
    entityId: ticketId,
    actorId: actor.id,
    newValue: { code, type },
  });
  const row = db.prepare(`${SELECT_TICKET} WHERE t.id = ?`).get(ticketId) as
    | (Record<string, unknown> & { id: number })
    | undefined;
  return mapTicket(row!);
}

export async function listTickets(actor: Actor, code?: string): Promise<TicketDetail[]> {
  requireCoupe(actor);
  const db = sessionsDb();
  if (code) {
    const row = db.prepare(`${SELECT_TICKET} WHERE t.code = ?`).get(code) as
      | (Record<string, unknown> & { id: number })
      | undefined;
    if (!row) {
      throw new ServiceError('Ticket introuvable : vérifiez le code scanné.', 404);
    }
    const ticket = mapTicket(row);
    if (ticket.status === 'annule') {
      ticket.observations =
        (ticket.observations ? `${ticket.observations} — ` : '') + 'Ticket annulé.';
    }
    return [await withQr(ticket)];
  }
  const rows = db.prepare(`${SELECT_TICKET} ORDER BY t.id DESC LIMIT 200`).all() as Array<
    Record<string, unknown> & { id: number }
  >;
  return Promise.all(rows.map((row) => withQr(mapTicket(row))));
}

export async function reprintTicket(
  actor: Actor,
  id: number,
  observations?: string | null,
): Promise<TicketDetail> {
  requireCoupe(actor);
  const db = sessionsDb();
  const ticketId = requireId(id, 'Ticket');
  const row = db.prepare('SELECT id FROM production_tickets WHERE id = ?').get(ticketId);
  if (!row) throw new ServiceError('Ticket introuvable.', 404);
  // §20.E : même identifiant, traçabilité de la réimpression, jamais
  // de nouvelle opération de production.
  db.prepare(
    `UPDATE production_tickets SET reprint_count = reprint_count + 1,
       last_reprint_by = ?, last_reprint_at = datetime('now'),
       observations = COALESCE(?, observations), updated_at = datetime('now')
     WHERE id = ?`,
  ).run(actor.id, normalizeText(observations, 500), ticketId);
  addHistory(db, {
    action: 'reprint',
    entityType: 'production_ticket',
    entityId: ticketId,
    actorId: actor.id,
  });
  const updated = db.prepare(`${SELECT_TICKET} WHERE t.id = ?`).get(ticketId) as
    | (Record<string, unknown> & { id: number })
    | undefined;
  return withQr(mapTicket(updated!));
}

export function cancelTicket(actor: Actor, id: number, reason: string | null): void {
  requireCoupe(actor);
  const db = sessionsDb();
  const ticketId = requireId(id, 'Ticket');
  const row = db
    .prepare('SELECT status FROM production_tickets WHERE id = ?')
    .get(ticketId) as { status: string } | undefined;
  if (!row) throw new ServiceError('Ticket introuvable.', 404);
  if (row.status === 'annule') {
    throw new ServiceError('Ticket déjà annulé.', 400);
  }
  db.prepare(
    `UPDATE production_tickets SET status = 'annule',
       observations = COALESCE(?, observations), updated_at = datetime('now')
     WHERE id = ?`,
  ).run(normalizeText(reason, 500), ticketId);
  addHistory(db, {
    action: 'cancel',
    entityType: 'production_ticket',
    entityId: ticketId,
    actorId: actor.id,
    reason,
  });
}
