import { ServiceError } from '@/server/api/service-error';
import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import type { StCartonDTO, StCartonLineDTO, StCartonStatus } from '@/types/stock';
import { addHistory, nextCode, normalizeText, requireId, requireStock, requireText } from './common';

/**
 * Cartons : création, consultation, clôture, réouverture autorisée,
 * annulation contrôlée, recherche par code et réimpression d'étiquette.
 * Les lignes ne sont jamais saisies à la main : elles proviennent des
 * entrées depuis les transferts conformes du Contrôle qualité.
 */

const CARTON_STATUSES: StCartonStatus[] = [
  'remplissage',
  'cloture',
  'bloque',
  'partiellement_sorti',
  'vide',
  'annule',
];

interface CartonRow {
  id: number;
  code: string;
  status: StCartonStatus;
  location_id: number | null;
  location_code: string | null;
  location_label: string | null;
  notes: string | null;
  created_by_name: string | null;
  created_at: string;
  closed_at: string | null;
}

interface LineRow {
  lot_id: number;
  lot_code: string;
  controle_id: number;
  controle_code: string;
  size_id: number;
  size_label: string;
  qty: number;
}

export function cartonPayload(code: string): string {
  return `JO|CARTON|${code}`;
}

function linesOf(db: import('better-sqlite3').Database, cartonId: number): StCartonLineDTO[] {
  return (
    db
      .prepare(
        `SELECT cl.lot_id, l.code AS lot_code, cl.controle_id,
                c.code AS controle_code, cl.size_id, s.nom AS size_label, cl.qty
         FROM st_carton_lines cl
         JOIN coupe_lots l ON l.id = cl.lot_id
         JOIN cq_controles c ON c.id = cl.controle_id
         JOIN sizes s ON s.id = cl.size_id
         WHERE cl.carton_id = ? ORDER BY l.code, s.nom`,
      )
      .all(cartonId) as LineRow[]
  ).map((row) => ({
    lotId: row.lot_id,
    lotCode: row.lot_code,
    controleId: row.controle_id,
    controleCode: row.controle_code,
    sizeId: row.size_id,
    sizeLabel: row.size_label,
    qty: row.qty,
  }));
}

function mapCarton(
  db: import('better-sqlite3').Database,
  row: CartonRow,
): StCartonDTO {
  const lines = linesOf(db, row.id);
  return {
    id: row.id,
    code: row.code,
    status: row.status,
    locationId: row.location_id,
    locationCode: row.location_code,
    locationLabel: row.location_label,
    notes: row.notes,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    closedAt: row.closed_at,
    identifier:
      row.status === 'annule'
        ? null
        : { code: row.code, qrPayload: cartonPayload(row.code) },
    totalQty: lines.reduce((sum, line) => sum + line.qty, 0),
    lines,
  };
}

const CARTON_SELECT = `
  SELECT c.*, loc.code AS location_code, loc.label AS location_label,
         u.nom || ' ' || u.prenom AS created_by_name
  FROM st_cartons c
  LEFT JOIN st_locations loc ON loc.id = c.location_id
  LEFT JOIN users u ON u.id = c.created_by`;

export function listCartons(actor: Actor): StCartonDTO[] {
  requireStock(actor);
  const db = sessionsDb();
  return (
    db.prepare(`${CARTON_SELECT} WHERE c.status != 'annule' ORDER BY c.id DESC`).all() as CartonRow[]
  ).map((row) => mapCarton(db, row));
}

export function getCarton(actor: Actor, cartonId: number): StCartonDTO {
  requireStock(actor);
  const db = sessionsDb();
  const row = db.prepare(`${CARTON_SELECT} WHERE c.id = ?`).get(cartonId) as
    | CartonRow
    | undefined;
  if (!row) throw new ServiceError('Carton introuvable.', 404);
  return mapCarton(db, row);
}

export function createCarton(
  actor: Actor,
  input: Record<string, unknown>,
): StCartonDTO {
  requireStock(actor);
  const db = sessionsDb();
  const manualCode = normalizeText(input.code, 50)?.toUpperCase() ?? null;
  const notes = normalizeText(input.notes, 300);
  const run = db.transaction((): number => {
    if (manualCode) {
      const existing = db
        .prepare('SELECT id FROM st_cartons WHERE code = ?')
        .get(manualCode) as { id: number } | undefined;
      if (existing) {
        throw new ServiceError(
          `Le code de carton « ${manualCode} » est déjà utilisé.`,
          409,
        );
      }
    }
    const code = manualCode ?? nextCode(db, 'st_cartons', 'CT-');
    const result = db
      .prepare(
        `INSERT INTO st_cartons (code, notes, created_by) VALUES (?, ?, ?)`,
      )
      .run(code, notes, actor.id);
    const id = Number(result.lastInsertRowid);
    addHistory(db, {
      action: 'CARTON_CREE',
      entityType: 'st_carton',
      entityId: id,
      actorId: actor.id,
      newValue: { code },
    });
    return id;
  });
  const id = run();
  return getCarton(actor, id);
}

function cartonWithLock(db: import('better-sqlite3').Database, cartonId: number): {
  id: number;
  code: string;
  status: StCartonStatus;
} {
  const row = db
    .prepare('SELECT id, code, status FROM st_cartons WHERE id = ?')
    .get(cartonId) as { id: number; code: string; status: StCartonStatus } | undefined;
  if (!row) throw new ServiceError('Carton introuvable.', 404);
  return row;
}

export function closeCarton(
  actor: Actor,
  input: Record<string, unknown>,
): StCartonDTO {
  requireStock(actor);
  const db = sessionsDb();
  const cartonId = requireId(input.cartonId, 'Carton');
  const locationId = requireId(input.locationId, 'Emplacement');
  const notes = normalizeText(input.notes, 300);
  const run = db.transaction((): void => {
    const carton = cartonWithLock(db, cartonId);
    if (carton.status !== 'remplissage' && carton.status !== 'vide') {
      throw new ServiceError(
        `Seul un carton en remplissage peut être clôturé (statut actuel : ${carton.status}).`,
        409,
      );
    }
    const location = db
      .prepare('SELECT id, is_active FROM st_locations WHERE id = ?')
      .get(locationId) as { id: number; is_active: number } | undefined;
    if (!location || location.is_active !== 1) {
      throw new ServiceError('Emplacement inactif ou introuvable.', 400);
    }
    const total = db
      .prepare('SELECT COALESCE(SUM(qty), 0) AS total FROM st_carton_lines WHERE carton_id = ?')
      .get(cartonId) as { total: number };
    if (total.total <= 0) {
      throw new ServiceError(
        'Un carton vide ne peut pas être clôturé : annulez-le plutôt.',
        409,
      );
    }
    db.prepare(
      `UPDATE st_cartons
       SET status = 'cloture', location_id = ?, closed_at = datetime('now'),
           updated_at = datetime('now'), notes = COALESCE(?, notes)
       WHERE id = ?`,
    ).run(locationId, notes, cartonId);
    addHistory(db, {
      action: 'CARTON_CLOTURE',
      entityType: 'st_carton',
      entityId: cartonId,
      actorId: actor.id,
      oldValue: { status: carton.status },
      newValue: { status: 'cloture', locationId },
    });
  });
  run();
  return getCarton(actor, cartonId);
}

/** Réouverture autorisée : correction traçable, motif obligatoire. */
export function reopenCarton(actor: Actor, input: Record<string, unknown>): StCartonDTO {
  requireStock(actor);
  const db = sessionsDb();
  const cartonId = requireId(input.cartonId, 'Carton');
  const reason = requireText(input.reason, 'Le motif', 300);
  const run = db.transaction((): void => {
    const carton = cartonWithLock(db, cartonId);
    if (carton.status !== 'cloture' && carton.status !== 'bloque') {
      throw new ServiceError(
        `Seul un carton clôturé ou bloqué peut être rouvert (statut actuel : ${carton.status}).`,
        409,
      );
    }
    db.prepare(
      `UPDATE st_cartons SET status = 'remplissage', closed_at = NULL,
       updated_at = datetime('now') WHERE id = ?`,
    ).run(cartonId);
    addHistory(db, {
      action: 'CARTON_ROUVERT',
      entityType: 'st_carton',
      entityId: cartonId,
      actorId: actor.id,
      oldValue: { status: carton.status },
      newValue: { status: 'remplissage' },
      reason,
    });
  });
  run();
  return getCarton(actor, cartonId);
}

export function cancelCarton(actor: Actor, input: Record<string, unknown>): void {
  requireStock(actor);
  const db = sessionsDb();
  const cartonId = requireId(input.cartonId, 'Carton');
  const reason = requireText(input.reason, 'Le motif', 300);
  const run = db.transaction((): void => {
    const carton = cartonWithLock(db, cartonId);
    if (carton.status === 'annule') return;
    if (!CARTON_STATUSES.includes(carton.status)) {
      throw new ServiceError('Statut de carton inconnu.', 400);
    }
    const lines = db
      .prepare('SELECT COALESCE(SUM(qty), 0) AS total FROM st_carton_lines WHERE carton_id = ?')
      .get(cartonId) as { total: number };
    if (lines.total > 0) {
      throw new ServiceError(
        'Un carton contenant des pièces ne peut pas être annulé : passez par un inventaire et un ajustement validé.',
        409,
      );
    }
    const movements = db
      .prepare('SELECT COUNT(*) AS n FROM st_movements WHERE carton_id = ?')
      .get(cartonId) as { n: number };
    if (movements.n > 0) {
      throw new ServiceError(
        'Un carton déjà mouvementé ne peut pas être annulé.',
        409,
      );
    }
    db.prepare(
      `UPDATE st_cartons SET status = 'annule', updated_at = datetime('now') WHERE id = ?`,
    ).run(cartonId);
    addHistory(db, {
      action: 'CARTON_ANNULE',
      entityType: 'st_carton',
      entityId: cartonId,
      actorId: actor.id,
      oldValue: { status: carton.status },
      newValue: { status: 'annule' },
      reason,
    });
  });
  run();
}

/** Réimpression : le code et l'identifiant stable restent inchangés. */
export function reprintLabel(
  actor: Actor,
  input: Record<string, unknown>,
): { code: string; qrPayload: string } {
  requireStock(actor);
  const db = sessionsDb();
  const cartonId = requireId(input.cartonId, 'Carton');
  const carton = cartonWithLock(db, cartonId);
  if (carton.status === 'annule') {
    throw new ServiceError('Ce carton est annulé.', 409);
  }
  addHistory(db, {
    action: 'ETIQUETTE_REIMPRIMEE',
    entityType: 'st_carton',
    entityId: cartonId,
    actorId: actor.id,
    newValue: { code: carton.code, qrPayload: cartonPayload(carton.code) },
  });
  return { code: carton.code, qrPayload: cartonPayload(carton.code) };
}
