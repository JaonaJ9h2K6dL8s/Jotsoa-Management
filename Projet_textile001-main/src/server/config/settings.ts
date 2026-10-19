import { writeAudit } from '@/server/auth/audit';
import { ServiceError } from '@/server/api/service-error';
import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import type { SettingRow } from '@/types/config';

/**
 * Paramètres généraux : stockés dans la table app_meta existante.
 * Aucun secret, mot de passe ou clé privée ne passe par ce mécanisme.
 */

export const SETTING_KEYS = [
  'company_name',
  'app_name',
  'app_subtitle',
  'timezone',
  'date_format',
  'default_page_size',
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];

const LABELS: Record<SettingKey, string> = {
  company_name: "Nom de l'entreprise",
  app_name: "Nom de l'application",
  app_subtitle: "Sous-titre de l'application",
  timezone: 'Fuseau horaire',
  date_format: "Format d'affichage des dates",
  default_page_size: 'Lignes par page (tableaux)',
};

const MAX_LENGTHS: Record<SettingKey, number> = {
  company_name: 60,
  app_name: 60,
  app_subtitle: 120,
  timezone: 60,
  date_format: 30,
  default_page_size: 3,
};

interface MetaRow {
  key: string;
  value: string;
  updated_at: string;
}

export function listSettings(): SettingRow[] {
  const db = sessionsDb();
  const placeholders = SETTING_KEYS.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT key, value, updated_at FROM app_meta WHERE key IN (${placeholders}) ORDER BY key`,
    )
    .all(...SETTING_KEYS) as MetaRow[];
  return rows.map((row) => ({
    key: row.key,
    value: row.value,
    updatedAt: row.updated_at,
  }));
}

function validateValue(key: SettingKey, value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ServiceError(`${LABELS[key]} est requis.`, 400);
  }
  const trimmed = value.trim();
  if (trimmed.length > MAX_LENGTHS[key]) {
    throw new ServiceError(
      `${LABELS[key]} ne doit pas dépasser ${MAX_LENGTHS[key]} caractères.`,
      400,
    );
  }
  if (key === 'default_page_size') {
    const size = Number(trimmed);
    if (!Number.isInteger(size) || size < 10 || size > 100) {
      throw new ServiceError(
        'Le nombre de lignes par page doit être un entier entre 10 et 100.',
        400,
      );
    }
  }
  if (key === 'timezone' && !/^[A-Za-z_]+\/[A-Za-z_]+$/.test(trimmed)) {
    throw new ServiceError(
      'Le fuseau horaire doit être au format Zone/Ville (ex. Indian/Antananarivo).',
      400,
    );
  }
  return trimmed;
}

export function updateSettings(
  actor: Actor,
  input: Record<string, unknown>,
): SettingRow[] {
  if (actor.roleCode !== 'admin') {
    throw new ServiceError('Seul un administrateur peut modifier les paramètres.', 403);
  }
  const db = sessionsDb();
  const updates: Array<{ key: SettingKey; value: string }> = [];
  for (const [key, value] of Object.entries(input)) {
    if (!SETTING_KEYS.includes(key as SettingKey)) {
      throw new ServiceError(`Paramètre inconnu : ${key}.`, 400);
    }
    updates.push({ key: key as SettingKey, value: validateValue(key as SettingKey, value) });
  }
  if (updates.length === 0) {
    throw new ServiceError('Aucun paramètre à mettre à jour.', 400);
  }
  const apply = db.transaction(() => {
    for (const update of updates) {
      db.prepare(
        `INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      ).run(update.key, update.value);
    }
    writeAudit(db, {
      action: 'SETTINGS_UPDATED',
      actorUserId: actor.id,
      details: { keys: updates.map((update) => update.key) },
    });
  });
  apply();
  return listSettings();
}
