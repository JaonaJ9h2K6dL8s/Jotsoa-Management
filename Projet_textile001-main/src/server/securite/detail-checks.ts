import type Database from 'better-sqlite3';
import { createAnomaly } from './anomalies';

/**
 * Vérifications détaillées effectuées à la clôture d'un contrôle :
 * niveau 2 (références des cartons comptés) et niveau 3 (quantités
 * vérifiées comparées aux quantités déclarées).
 */

/** Niveau 2 : le contenu des cartons comptés correspond au dossier. */
export function checkReferences(
  db: Database.Database,
  controlId: number,
  dossierId: number,
  actorId: number,
): void {
  const mismatches = db
    .prepare(
      `SELECT c.code AS carton_code, p.nom AS product_nom, s.nom AS size_nom
       FROM sec_observations o
       JOIN st_cartons c ON c.id = o.carton_id
       JOIN st_carton_lines cl ON cl.carton_id = c.id
       JOIN coupe_lots l ON l.id = cl.lot_id
       JOIN products p ON p.id = l.product_id
       JOIN sizes s ON s.id = cl.size_id
       WHERE o.controle_id = ? AND o.result = 'attendu'
         AND NOT EXISTS (
           SELECT 1 FROM mg_order_lines ol
           JOIN mg_dossiers d ON d.order_id = ol.order_id AND d.id = ?
           WHERE ol.match_status = 'reconnu'
             AND ol.product_id = l.product_id AND ol.size_id = cl.size_id)`,
    )
    .all(controlId, dossierId) as Array<{
    carton_code: string;
    product_nom: string;
    size_nom: string;
  }>;
  for (const row of mismatches) {
    createAnomaly(db, {
      dossierId,
      controleId: controlId,
      cartonId: null,
      type: 'reference_incoherente',
      severity: 'critical',
      description: `Le carton ${row.carton_code} contient ${row.product_nom} / ${row.size_nom} qui ne figure pas dans le dossier.`,
      detectedBy: actorId,
    });
  }
}

/** Niveau 3 : quantités vérifiées comparées aux quantités déclarées. */
export function checkQuantities(
  db: Database.Database,
  controlId: number,
  dossierId: number,
  actorId: number,
): void {
  const lines = db
    .prepare(
      `SELECT l.id, l.qty_prepared FROM mg_order_lines l
       JOIN mg_dossiers d ON d.order_id = l.order_id AND d.id = ?`,
    )
    .all(dossierId) as Array<{ id: number; qty_prepared: number }>;
  for (const line of lines) {
    const check = db
      .prepare(
        'SELECT qty_checked FROM sec_line_checks WHERE controle_id = ? AND order_line_id = ?',
      )
      .get(controlId, line.id) as { qty_checked: number } | undefined;
    if (!check) {
      createAnomaly(db, {
        dossierId,
        controleId: controlId,
        cartonId: null,
        type: 'quantite_ecart',
        severity: 'warning',
        description: `Ligne #${line.id} : quantité non vérifiée (contrôle détaillé exigé).`,
        detectedBy: actorId,
      });
    } else if (Math.abs(check.qty_checked - line.qty_prepared) > 1e-9) {
      createAnomaly(db, {
        dossierId,
        controleId: controlId,
        cartonId: null,
        type: 'quantite_ecart',
        severity: 'critical',
        description: `Ligne #${line.id} : ${line.qty_prepared} déclarée(s), ${check.qty_checked} vérifiée(s).`,
        detectedBy: actorId,
      });
    }
  }
}
