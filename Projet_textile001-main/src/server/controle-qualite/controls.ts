import { ServiceError } from '@/server/api/service-error';
import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import type { ControlStatus, CqControlDTO } from '@/types/cq';
import { raiseAlert } from '@/server/alerts/alerts';
import {
  addHistory,
  nextCode,
  normalizeText,
  requireCq,
  requireId,
} from './common';

/**
 * Contrôles qualité : création à partir d'une réception, saisie des
 * quantités inspectées et conformes par taille, transitions contrôlées.
 * Fin de saisie ≠ validation : la validation exige que chaque pièce
 * inspectée ait reçu une décision définitive (conforme, retouche ou
 * rebut) — les quantités en attente bloquent la validation.
 */

interface ControlRow {
  id: number;
  code: string;
  reception_id: number;
  lot_id: number;
  product_id: number;
  color_id: number;
  status: ControlStatus;
  notes: string | null;
  created_at: string;
  reception_code: string;
  lot_code: string;
  product_nom: string;
  color_nom: string;
  controlled_by_name: string | null;
}

const CONTROL_SELECT = `
  SELECT c.*, r.code AS reception_code, l.code AS lot_code,
         p.nom AS product_nom, co.nom AS color_nom,
         u.nom || ' ' || u.prenom AS controlled_by_name
  FROM cq_controles c
  JOIN cq_receptions r ON r.id = c.reception_id
  JOIN coupe_lots l ON l.id = c.lot_id
  JOIN products p ON p.id = c.product_id
  JOIN colors co ON co.id = c.color_id
  JOIN users u ON u.id = c.controlled_by`;

const CONTROL_STATUSES: ControlStatus[] = [
  'en_attente',
  'en_cours',
  'incomplet',
  'attente_validation',
  'valide',
  'bloque',
  'cloture',
];

function mapControl(db: ReturnType<typeof sessionsDb>, row: ControlRow): CqControlDTO {
  const lines = db
    .prepare(
      `SELECT cl.size_id, s.nom AS size_label, cl.inspected_qty, cl.conforme_qty,
              COALESCE((SELECT rl.received_qty FROM cq_reception_lines rl
                WHERE rl.reception_id = ? AND rl.size_id = cl.size_id), 0) AS received_qty
       FROM cq_controle_lines cl
       JOIN sizes s ON s.id = cl.size_id
       WHERE cl.controle_id = ? ORDER BY s.display_order, s.id`,
    )
    .all(row.reception_id, row.id) as Array<{
    size_id: number;
    size_label: string;
    inspected_qty: number;
    conforme_qty: number;
    received_qty: number;
  }>;
  const defauts = db
    .prepare(
      `SELECT d.*, df.nom AS defect_nom, df.category AS defect_category,
              s.nom AS size_label, rz.nom AS rework_zone_nom,
              u.nom || ' ' || u.prenom AS declared_by_name
       FROM cq_defauts d
       JOIN defects df ON df.id = d.defect_id
       JOIN sizes s ON s.id = d.size_id
       LEFT JOIN rework_zones rz ON rz.id = d.rework_zone_id
       JOIN users u ON u.id = d.declared_by
       WHERE d.controle_id = ? ORDER BY d.id DESC`,
    )
    .all(row.id) as Array<{
    id: number;
    controle_id: number;
    lot_id: number;
    size_id: number;
    size_label: string;
    defect_id: number;
    defect_nom: string;
    defect_category: string | null;
    rework_zone_nom: string | null;
    qty_pieces: number;
    description: string | null;
    severity: 'mineure' | 'majeure' | 'critique';
    decision: 'attente' | 'retouche' | 'rebut';
    declared_by_name: string | null;
    created_at: string;
  }>;
  return {
    id: row.id,
    code: row.code,
    receptionId: row.reception_id,
    receptionCode: row.reception_code,
    lotId: row.lot_id,
    lotCode: row.lot_code,
    productNom: row.product_nom,
    colorNom: row.color_nom,
    status: row.status,
    controlledByName: row.controlled_by_name,
    notes: row.notes,
    createdAt: row.created_at,
    lines: lines.map((line) => ({
      sizeId: line.size_id,
      sizeLabel: line.size_label,
      receivedQty: line.received_qty,
      inspectedQty: line.inspected_qty,
      conformeQty: line.conforme_qty,
    })),
    defauts: defauts.map((defaut) => ({
      id: defaut.id,
      controleId: defaut.controle_id,
      lotId: defaut.lot_id,
      lotCode: row.lot_code,
      sizeId: defaut.size_id,
      sizeLabel: defaut.size_label,
      defectId: defaut.defect_id,
      defectNom: defaut.defect_nom,
      defectCategory: defaut.defect_category,
      reworkZoneNom: defaut.rework_zone_nom,
      qtyPieces: defaut.qty_pieces,
      description: defaut.description,
      severity: defaut.severity,
      decision: defaut.decision,
      declaredByName: defaut.declared_by_name,
      createdAt: defaut.created_at,
    })),
  };
}

export function listControls(actor: Actor): CqControlDTO[] {
  requireCq(actor);
  const db = sessionsDb();
  return (db.prepare(`${CONTROL_SELECT} ORDER BY c.id DESC`).all() as ControlRow[]).map(
    (row) => mapControl(db, row),
  );
}

export function getControl(actor: Actor, rawId: unknown): CqControlDTO {
  requireCq(actor);
  const id = requireId(rawId, 'Contrôle');
  const db = sessionsDb();
  const row = db.prepare(`${CONTROL_SELECT} WHERE c.id = ?`).get(id) as
    | ControlRow
    | undefined;
  if (!row) throw new ServiceError('Contrôle introuvable.', 404);
  return mapControl(db, row);
}

/**
 * Crée le contrôle d'une réception (un seul par réception). La
 * réception doit être complète : une réception partielle reste bloquée
 * tant que l'écart n'est pas résolu.
 */
export function createControl(
  actor: Actor,
  input: Record<string, unknown>,
): CqControlDTO {
  requireCq(actor);
  const db = sessionsDb();
  const receptionId = requireId(input.receptionId, 'Réception');
  const notes = normalizeText(input.notes, 500);
  const insert = db.transaction((): number => {
    const reception = db
      .prepare('SELECT id, lot_id, status FROM cq_receptions WHERE id = ?')
      .get(receptionId) as
      | { id: number; lot_id: number; status: string }
      | undefined;
    if (!reception) throw new ServiceError('Réception introuvable.', 404);
    if (reception.status !== 'complete') {
      throw new ServiceError(
        'Une réception partielle ne peut pas être contrôlée tant que l’écart n’est pas résolu.',
        409,
      );
    }
    const existing = db
      .prepare('SELECT id FROM cq_controles WHERE reception_id = ?')
      .get(receptionId) as { id: number } | undefined;
    if (existing) {
      throw new ServiceError('Un contrôle existe déjà pour cette réception.', 409);
    }
    const lot = db
      .prepare('SELECT product_id, color_id FROM coupe_lots WHERE id = ?')
      .get(reception.lot_id) as { product_id: number; color_id: number };
    const code = nextCode(db, 'cq_controles', 'CQ-');
    const result = db
      .prepare(
        `INSERT INTO cq_controles
           (code, reception_id, lot_id, product_id, color_id, status, controlled_by, notes)
         VALUES (?, ?, ?, ?, ?, 'en_attente', ?, ?)`,
      )
      .run(code, receptionId, reception.lot_id, lot.product_id, lot.color_id, actor.id, notes);
    const controleId = Number(result.lastInsertRowid);
    // Lignes pré-créées par taille reçue : quantités inspectées à 0.
    const sizes = db
      .prepare(
        `SELECT size_id, received_qty FROM cq_reception_lines WHERE reception_id = ?`,
      )
      .all(receptionId) as Array<{ size_id: number; received_qty: number }>;
    for (const size of sizes) {
      db.prepare(
        `INSERT INTO cq_controle_lines (controle_id, size_id, inspected_qty, conforme_qty)
         VALUES (?, ?, 0, 0)`,
      ).run(controleId, size.size_id);
    }
    addHistory(db, {
      action: 'CONTROLE_CREATED',
      entityType: 'cq_controle',
      entityId: controleId,
      actorId: actor.id,
      newValue: { code, receptionId },
    });
    return controleId;
  });
  const controleId = insert();
  const row = db
    .prepare(`${CONTROL_SELECT} WHERE c.id = ?`)
    .get(controleId) as ControlRow;
  return mapControl(db, row);
}

/** Total des pièces à retoucher ou rebutées pour un contrôle/taille. */
function decidedDefauts(
  db: ReturnType<typeof sessionsDb>,
  controleId: number,
  sizeId: number,
): { rework: number; rebut: number; pendingDefauts: number } {
  const reworkRow = db
    .prepare(
      `SELECT COALESCE(SUM(rwl.qty), 0) AS qty FROM cq_rework_lines rwl
       JOIN cq_rework_requests rw ON rw.id = rwl.request_id
       WHERE rw.controle_id = ? AND rw.status != 'annulee' AND rwl.size_id = ?`,
    )
    .get(controleId, sizeId) as { qty: number };
  const rebutRow = db
    .prepare(
      `SELECT COALESCE(SUM(qty_pieces), 0) AS qty FROM cq_defauts
       WHERE controle_id = ? AND size_id = ? AND decision = 'rebut'`,
    )
    .get(controleId, sizeId) as { qty: number };
  const pendingRow = db
    .prepare(
      `SELECT COALESCE(SUM(qty_pieces), 0) AS qty FROM cq_defauts
       WHERE controle_id = ? AND size_id = ? AND decision = 'attente'`,
    )
    .get(controleId, sizeId) as { qty: number };
  return { rework: reworkRow.qty, rebut: rebutRow.qty, pendingDefauts: pendingRow.qty };
}

/** Vérifie la cohérence inspecté/décisions d'un contrôle (partagé). */
export function checkControlCoherence(
  db: ReturnType<typeof sessionsDb>,
  controleId: number,
  lotId: number,
): void {
  const lines = db
    .prepare(
      `SELECT cl.size_id, cl.inspected_qty, cl.conforme_qty,
              COALESCE((SELECT rl.received_qty FROM cq_reception_lines rl
                JOIN cq_receptions r ON r.id = rl.reception_id
                WHERE r.id = (SELECT reception_id FROM cq_controles WHERE id = ?)
                  AND rl.size_id = cl.size_id), 0) AS received_qty
       FROM cq_controle_lines cl WHERE cl.controle_id = ?`,
    )
    .all(controleId, controleId) as Array<{
    size_id: number;
    inspected_qty: number;
    conforme_qty: number;
    received_qty: number;
  }>;
  for (const line of lines) {
    if (line.inspected_qty > line.received_qty) {
      raiseAlert(db, {
        category: 'CONTROLE_EXCEDENT_CQ',
        severity: 'warning',
        objectType: 'cq_controle',
        objectId: controleId,
        message: `Quantité inspectée (${line.inspected_qty}) supérieure à la quantité reçue (${line.received_qty}) en taille ${line.size_id}.`,
        ownerRole: 'controleur_qualite',
      });
      throw new ServiceError(
        `Quantité inspectée supérieure à la quantité reçue en taille ${line.size_id}.`,
        409,
      );
    }
    if (line.conforme_qty > line.inspected_qty) {
      throw new ServiceError(
        `Quantité conforme supérieure à la quantité inspectée en taille ${line.size_id}.`,
        409,
      );
    }
    const decided = decidedDefauts(db, controleId, line.size_id);
    if (decided.rework + decided.rebut + line.conforme_qty > line.inspected_qty) {
      throw new ServiceError(
        `Les décisions (conforme + retouche + rebut) dépassent la quantité inspectée en taille ${line.size_id}.`,
        409,
      );
    }
  }
  void lotId;
}

export { decidedDefauts, CONTROL_STATUSES };
