import { ServiceError } from '@/server/api/service-error';
import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import type { StLocationDTO } from '@/types/stock';
import { addHistory, normalizeText, requireId, requireStock, requireText } from './common';

/**
 * Emplacements de stockage configurables : zone, salle, rangée,
 * étagère, niveau ou emplacement précis. Aucune structure physique
 * n'est imposée : l'entreprise choisit ses niveaux d'organisation.
 */

const AREAS = ['zone', 'salle', 'rangee', 'etagere', 'niveau', 'emplacement'] as const;

interface LocationRow {
  id: number;
  code: string;
  label: string;
  area: StLocationDTO['area'];
  is_active: number;
  notes: string | null;
  cartons_count: number;
}

function mapLocation(row: LocationRow): StLocationDTO {
  return {
    id: row.id,
    code: row.code,
    label: row.label,
    area: row.area,
    isActive: row.is_active === 1,
    notes: row.notes,
    cartonsCount: row.cartons_count,
  };
}

export function listLocations(actor: Actor): StLocationDTO[] {
  requireStock(actor);
  const db = sessionsDb();
  return (
    db
      .prepare(
        `SELECT l.*, (SELECT COUNT(*) FROM st_cartons c
                      WHERE c.location_id = l.id
                        AND c.status NOT IN ('annule','vide')) AS cartons_count
         FROM st_locations l ORDER BY l.code`,
      )
      .all() as LocationRow[]
  ).map(mapLocation);
}

export function createLocation(
  actor: Actor,
  input: Record<string, unknown>,
): StLocationDTO {
  requireStock(actor);
  const db = sessionsDb();
  const code = requireText(input.code, 'Le code', 50).toUpperCase();
  const label = requireText(input.label, 'Le libellé', 100);
  const areaRaw = String(input.area ?? 'emplacement');
  if (!(AREAS as readonly string[]).includes(areaRaw)) {
    throw new ServiceError('Type de emplacement inconnu.', 400);
  }
  const notes = normalizeText(input.notes, 300);
  const existing = db
    .prepare('SELECT id FROM st_locations WHERE code = ?')
    .get(code) as { id: number } | undefined;
  if (existing) {
    throw new ServiceError(`Le code d'emplacement « ${code} » existe déjà.`, 409);
  }
  const run = db.transaction((): number => {
    const result = db
      .prepare(
        `INSERT INTO st_locations (code, label, area, notes, created_by)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(code, label, areaRaw, notes, actor.id);
    const id = Number(result.lastInsertRowid);
    addHistory(db, {
      action: 'EMPLACEMENT_CREE',
      entityType: 'st_location',
      entityId: id,
      actorId: actor.id,
      newValue: { code, label, area: areaRaw },
    });
    return id;
  });
  const id = run();
  const row = db
    .prepare(
      `SELECT l.*, 0 AS cartons_count FROM st_locations l WHERE l.id = ?`,
    )
    .get(id) as LocationRow;
  return mapLocation(row);
}

export function toggleLocation(
  actor: Actor,
  input: Record<string, unknown>,
): void {
  requireStock(actor);
  const db = sessionsDb();
  const id = requireId(input.locationId, 'Emplacement');
  const run = db.transaction((): void => {
    const row = db
      .prepare('SELECT id, code, is_active FROM st_locations WHERE id = ?')
      .get(id) as { id: number; code: string; is_active: number } | undefined;
    if (!row) throw new ServiceError('Emplacement introuvable.', 404);
    const next = row.is_active === 1 ? 0 : 1;
    if (next === 0) {
      const occupied = db
        .prepare(
          `SELECT COUNT(*) AS n FROM st_cartons
           WHERE location_id = ? AND status NOT IN ('annule','vide')`,
        )
        .get(id) as { n: number };
      if (occupied.n > 0) {
        throw new ServiceError(
          `${occupied.n} carton(s) sont encore rangés dans cet emplacement.`,
          409,
        );
      }
    }
    db.prepare('UPDATE st_locations SET is_active = ? WHERE id = ?').run(next, id);
    addHistory(db, {
      action: next === 1 ? 'EMPLACEMENT_ACTIVE' : 'EMPLACEMENT_DESACTIVE',
      entityType: 'st_location',
      entityId: id,
      actorId: actor.id,
      oldValue: { is_active: row.is_active },
      newValue: { is_active: next },
    });
  });
  run();
}
