import { sessionsDb } from '@/server/auth/sessions';
import type {
  DashboardAlert,
  DashboardData,
  DashboardRecentOperation,
} from '@/types/config';

/**
 * Tableau de bord administratif : compteurs réels, alertes de
 * configuration et dernières opérations journalisées.
 * Aucune donnée fictive.
 */

interface CountRow {
  usersActive: number;
  usersInactive: number;
  productTypes: number;
  products: number;
  colors: number;
  sizes: number;
  reworkZones: number;
  defects: number;
  sewingRooms: number;
  sewingLines: number;
  cadences: number;
}

function computeCounters(): CountRow {
  const db = sessionsDb();
  const count = (sql: string, ...params: unknown[]): number =>
    (db.prepare(sql).get(...params) as { n: number }).n;
  return {
    usersActive: count('SELECT COUNT(*) AS n FROM users WHERE is_active = 1'),
    usersInactive: count('SELECT COUNT(*) AS n FROM users WHERE is_active = 0'),
    productTypes: count('SELECT COUNT(*) AS n FROM product_types'),
    products: count('SELECT COUNT(*) AS n FROM products'),
    colors: count('SELECT COUNT(*) AS n FROM colors'),
    sizes: count('SELECT COUNT(*) AS n FROM sizes'),
    reworkZones: count('SELECT COUNT(*) AS n FROM rework_zones'),
    defects: count('SELECT COUNT(*) AS n FROM defects'),
    sewingRooms: count('SELECT COUNT(*) AS n FROM sewing_rooms'),
    sewingLines: count('SELECT COUNT(*) AS n FROM sewing_lines'),
    cadences: count('SELECT COUNT(*) AS n FROM production_cadences'),
  };
}

function computeAlerts(counters: CountRow): DashboardAlert[] {
  const alerts: DashboardAlert[] = [];
  if (counters.sewingRooms !== 3) {
    alerts.push({
      level: 'warning',
      message: `L'entreprise doit disposer de trois salles de couture : ${counters.sewingRooms} trouvée(s).`,
    });
  }
  if (counters.productTypes === 0) {
    alerts.push({
      level: 'info',
      message: 'Aucun type de produit configuré : configurez-en avant les modules métier.',
    });
  }
  if (counters.colors === 0 || counters.sizes === 0) {
    alerts.push({
      level: 'info',
      message: 'Couleurs ou tailles non configurées : nécessaires pour les variantes de produits.',
    });
  }
  if (counters.defects === 0 || counters.reworkZones === 0) {
    alerts.push({
      level: 'info',
      message: 'Zones de retouche ou défauts non configurés : nécessaires pour le contrôle qualité.',
    });
  }
  return alerts;
}

function recentOperations(): DashboardRecentOperation[] {
  const db = sessionsDb();
  const rows = db
    .prepare(
      `SELECT a.id, a.action, a.details, a.created_at AS createdAt,
              u.username AS actor
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.actor_user_id
       WHERE a.action IN ('CONFIG_CREATED','CONFIG_UPDATED','CONFIG_ACTIVATED',
                          'CONFIG_DEACTIVATED','SETTINGS_UPDATED','USER_CREATED',
                          'ROLE_CHANGED','PASSWORD_RESET','USER_DEACTIVATED')
       ORDER BY a.id DESC LIMIT 10`,
    )
    .all() as {
    id: number;
    action: string;
    details: string;
    createdAt: string;
    actor: string | null;
  }[];
  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    actor: row.actor,
    details: row.details,
    createdAt: row.createdAt,
  }));
}

export function getDashboardData(): DashboardData {
  const counters = computeCounters();
  return {
    counters,
    alerts: computeAlerts(counters),
    recentOperations: recentOperations(),
  };
}
