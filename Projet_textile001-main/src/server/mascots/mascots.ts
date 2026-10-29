import { sessionsDb } from '@/server/auth/sessions';
import { ServiceError } from '@/server/api/service-error';
import type { RoleCode } from '@/lib/roles';
import {
  buildMascotConfig,
  defaultMascotConfig,
  type MascotConfig,
} from '@/lib/mascots/registry';

/**
 * Préférences de mascotte par utilisateur.
 * L'identifiant vient toujours de la session authentifiée : aucun
 * utilisateur ne peut lire ou modifier la configuration d'un autre.
 * Si aucune préférence n'existe, une configuration par défaut
 * (suggérée selon le rôle) est renvoyée sans être écrite.
 */

interface MascotRow {
  mascot_id: string;
  animation_enabled: number;
  animation_style: string;
  animation_frequency: string;
  messages_enabled: number;
  position: string;
}

function rowToConfig(row: MascotRow): MascotConfig {
  // Les colonnes sont contraintes par des CHECK en base ; en cas
  // d'imprévu, on retombe sur la configuration par défaut du rôle.
  try {
    return buildMascotConfig(
      {
        mascotId: row.mascot_id,
        animationEnabled: Boolean(row.animation_enabled),
        animationStyle: row.animation_style,
        animationFrequency: row.animation_frequency,
        messagesEnabled: Boolean(row.messages_enabled),
        position: row.position,
      },
      'admin',
    );
  } catch {
    return defaultMascotConfig('admin');
  }
}

export function getMascotConfig(
  userId: number,
  roleCode: RoleCode,
): MascotConfig {
  const db = sessionsDb();
  const row = db
    .prepare(
      `SELECT mascot_id, animation_enabled, animation_style,
              animation_frequency, messages_enabled, position
       FROM user_mascots WHERE user_id = ?`,
    )
    .get(userId) as MascotRow | undefined;
  if (!row) {
    return defaultMascotConfig(roleCode);
  }
  return rowToConfig(row);
}

export function updateMascotConfig(
  userId: number,
  roleCode: RoleCode,
  input: Record<string, unknown>,
): MascotConfig {
  let config: MascotConfig;
  try {
    config = buildMascotConfig(input, roleCode);
  } catch (error) {
    throw new ServiceError(
      error instanceof Error ? error.message : 'Préférences invalides.',
      400,
    );
  }
  const db = sessionsDb();
  db.prepare(
    `INSERT INTO user_mascots
       (user_id, mascot_id, animation_enabled, animation_style,
        animation_frequency, messages_enabled, position, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       mascot_id = excluded.mascot_id,
       animation_enabled = excluded.animation_enabled,
       animation_style = excluded.animation_style,
       animation_frequency = excluded.animation_frequency,
       messages_enabled = excluded.messages_enabled,
       position = excluded.position,
       updated_at = excluded.updated_at`,
  ).run(
    userId,
    config.mascotId,
    config.animationEnabled ? 1 : 0,
    config.animationStyle,
    config.animationFrequency,
    config.messagesEnabled ? 1 : 0,
    config.position,
  );
  return config;
}
