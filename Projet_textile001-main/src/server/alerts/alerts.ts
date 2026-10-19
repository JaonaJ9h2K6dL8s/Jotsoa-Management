import type Database from 'better-sqlite3';

/**
 * Mécanisme central d'alertes (partagé entre les modules).
 * Une alerte signale un événement à vérifier — jamais une culpabilité.
 * Le dédoublonnage empêche plusieurs alertes ouvertes identiques.
 */

export type AlertSeverity = 'info' | 'warning' | 'critical';
export type AlertStatus = 'nouvelle' | 'en_cours' | 'resolue' | 'cloturee';

export interface AlertRow {
  id: number;
  category: string;
  severity: AlertSeverity;
  object_type: string | null;
  object_id: number | null;
  message: string;
  owner_role: string | null;
  status: AlertStatus;
  resolution: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Déclenche une alerte. Si une alerte ouverte (nouvelle ou en cours)
 * existe déjà pour la même catégorie et le même objet, elle n'est pas
 * dupliquée : la première reste la référence.
 */
export function raiseAlert(
  db: Database.Database,
  input: {
    category: string;
    severity: AlertSeverity;
    objectType?: string | null;
    objectId?: number | null;
    message: string;
    ownerRole?: string | null;
  },
): number | null {
  const existing = db
    .prepare(
      `SELECT id FROM alerts
       WHERE category = ? AND status IN ('nouvelle', 'en_cours')
         AND (object_type IS ? OR object_type = ?)
         AND (object_id IS ? OR object_id = ?)`,
    )
    .get(
      input.category,
      input.objectType ?? null,
      input.objectType ?? null,
      input.objectId ?? null,
      input.objectId ?? null,
    ) as { id: number } | undefined;
  if (existing) return existing.id;
  const result = db
    .prepare(
      `INSERT INTO alerts
         (category, severity, object_type, object_id, message, owner_role)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.category,
      input.severity,
      input.objectType ?? null,
      input.objectId ?? null,
      input.message,
      input.ownerRole ?? null,
    );
  return Number(result.lastInsertRowid);
}

export function listAlerts(
  db: Database.Database,
  filters: { status?: string; category?: string } = {},
): AlertRow[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filters.status) {
    clauses.push('status = ?');
    params.push(filters.status);
  }
  if (filters.category) {
    clauses.push('category = ?');
    params.push(filters.category);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return db
    .prepare(`SELECT * FROM alerts ${where} ORDER BY id DESC LIMIT 200`)
    .all(...params) as AlertRow[];
}

const TRANSITIONS: Record<AlertStatus, AlertStatus[]> = {
  nouvelle: ['en_cours', 'resolue', 'cloturee'],
  en_cours: ['resolue', 'cloturee'],
  resolue: ['cloturee'],
  cloturee: [],
};

/** Change le statut d'une alerte en respectant les transitions autorisées. */
export function updateAlertStatus(
  db: Database.Database,
  id: number,
  status: AlertStatus,
  resolution: string | null,
): void {
  const alert = db.prepare('SELECT * FROM alerts WHERE id = ?').get(id) as
    | AlertRow
    | undefined;
  if (!alert) {
    throw new Error('Alerte introuvable.');
  }
  if (!TRANSITIONS[alert.status].includes(status)) {
    throw new Error(
      `Transition d'alerte interdite : ${alert.status} → ${status}.`,
    );
  }
  if (
    (status === 'resolue' || status === 'cloturee') &&
    !(resolution && resolution.trim())
  ) {
    throw new Error(
      'Une résolution doit être enregistrée avant de clôturer une alerte.',
    );
  }
  db.prepare(
    "UPDATE alerts SET status = ?, resolution = COALESCE(?, resolution), updated_at = datetime('now') WHERE id = ?",
  ).run(status, resolution, id);
}
