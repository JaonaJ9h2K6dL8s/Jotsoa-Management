import type Database from 'better-sqlite3';
import { ServiceError } from '@/server/api/service-error';
import type { Actor } from '@/server/users/users-service';
import {
  parseNumberInput,
  validateCode,
  validateInitialWeight,
} from '@/lib/coupe-validation';
import { checkRollCoherence } from './fabric-estimate';
import { assertCoupeWrite, requireId, requireText, optionalId } from './common';

/**
 * Étape 1 du parcours : informations du rouleau.
 * Réutilise la table existante `coupe_rolls` (contrainte SQL 9–30 kg).
 * La longueur disponible est stockée via `initial_qty`/`qty_unit` ('m').
 * Consulter ou manipuler un rouleau ne le consomme jamais.
 */

export interface RollItem {
  id: number;
  code: string;
  fabricRef: string;
  colorNom: string | null;
  weightKg: number;
  lengthM: number | null;
  widthCm: number | null;
  usableWidthCm: number | null;
  grammageGm2: number | null;
  status: string;
}

interface RollRow {
  id: number;
  code: string;
  fabric_ref: string;
  color_id: number | null;
  color_nom: string | null;
  initial_weight_kg: number;
  initial_qty: number | null;
  remaining_qty: number | null;
  qty_unit: string | null;
  width_cm: number | null;
  usable_width_cm: number | null;
  grammage_g_m2: number | null;
  status: string;
}

const ROLL_SELECT = `
  SELECT r.id, r.code, r.fabric_ref, r.color_id, c.nom AS color_nom,
         r.initial_weight_kg, r.initial_qty, r.remaining_qty, r.qty_unit,
         r.width_cm, r.usable_width_cm, r.grammage_g_m2, r.status
    FROM coupe_rolls r
    LEFT JOIN colors c ON c.id = r.color_id`;

function toRollItem(row: RollRow): RollItem {
  return {
    id: row.id,
    code: row.code,
    fabricRef: row.fabric_ref,
    colorNom: row.color_nom,
    weightKg: row.initial_weight_kg,
    lengthM: row.qty_unit === 'm' ? row.initial_qty : null,
    widthCm: row.width_cm,
    usableWidthCm: row.usable_width_cm,
    grammageGm2: row.grammage_g_m2,
    status: row.status,
  };
}

export function listRolls(db: Database.Database): RollItem[] {
  const rows = db
    .prepare(`${ROLL_SELECT} WHERE r.status = 'disponible'
              ORDER BY r.received_at DESC, r.id DESC`)
    .all() as RollRow[];
  return rows.map(toRollItem);
}

export interface CreateRollInput {
  code: unknown;
  fabricRef: unknown;
  colorId: unknown;
  weightKg: unknown;
  /** Longueur (m) : absente → rouleau suivi en kg uniquement. */
  lengthM?: unknown;
  widthCm?: unknown;
  usableWidthCm?: unknown;
  grammageGm2?: unknown;
}

/**
 * Message d'incohérence poids/longueur/grammage/largeur (tolérance 10 %).
 * Explique l'écart et donne la longueur théorique attendue : aucune
 * valeur saisie n'est remplacée automatiquement.
 */
function coherenceError(
  weightKg: number, lengthM: number, grammageGm2: number, widthCm: number,
): ServiceError {
  const coherence = checkRollCoherence(weightKg, lengthM, grammageGm2, widthCm);
  const theoreticalLength = (weightKg * 1000) / (grammageGm2 * (widthCm / 100));
  return new ServiceError(
    `Incohérence poids/longueur/grammage/largeur : grammage implicite `
    + `${coherence.implicitGrammage.toFixed(1)} g/m² ≠ grammage déclaré `
    + `${grammageGm2} g/m² (écart ${coherence.deviationPct.toFixed(1)} %, `
    + `tolérance 10 %). Pour ${weightKg} kg à ${grammageGm2} g/m² sur `
    + `${widthCm} cm de large, la longueur attendue est d'environ `
    + `${theoreticalLength.toFixed(2)} m. Corrigez la saisie : aucune `
    + 'valeur n\'est remplacée automatiquement.',
    400,
  );
}

export function createRoll(
  db: Database.Database,
  actor: Actor,
  input: CreateRollInput,
): RollItem {
  assertCoupeWrite(actor);
  const codeError = validateCode(input.code, 'Le code du rouleau');
  if (codeError) throw new ServiceError(codeError, 400);
  const code = String(input.code).trim().toUpperCase();
  const fabricRef = requireText(input.fabricRef, 'La référence du tissu');
  const weight = parseNumberInput(input.weightKg);
  if (weight === null) {
    throw new ServiceError('Le poids initial est requis et doit être numérique.', 400);
  }
  const weightError = validateInitialWeight(weight);
  if (weightError) throw new ServiceError(weightError, 400);
  // Longueur optionnelle : absente → rouleau suivi en kg uniquement
  // (qty_unit 'kg', métrage inconnu, jamais inventé).
  const length = parseNumberInput(input.lengthM);
  if (length !== null && length <= 0) {
    throw new ServiceError(
      'La longueur disponible en mètres doit être positive (ou absente : suivi en kg seul).',
      400,
    );
  }
  const width = parseNumberInput(input.widthCm ?? null);
  if (width !== null && width <= 0) {
    throw new ServiceError('La largeur du tissu doit être positive.', 400);
  }
  const usable = parseNumberInput(input.usableWidthCm ?? null);
  if (usable !== null && usable <= 0) {
    throw new ServiceError(
      'La largeur utile du tissu doit être positive.',
      400,
    );
  }
  if (width !== null && usable !== null && usable > width) {
    throw new ServiceError(
      'La largeur utile ne peut pas dépasser la largeur du tissu.',
      400,
    );
  }
  const grammage = parseNumberInput(input.grammageGm2 ?? null);
  if (grammage !== null && grammage <= 0) {
    throw new ServiceError('Le grammage doit être positif.', 400);
  }
  // Cohérence kg/m/GSM/largeur : contrôlée seulement quand TOUTES les
  // données nécessaires sont présentes et fiables ; un rouleau suivi
  // en kg seul ou sans grammage reste gérable (contrôle non applicable).
  if (length !== null && grammage !== null && width !== null
    && checkRollCoherence(weight, length, grammage, width).anomaly) {
    throw coherenceError(weight, length, grammage, width);
  }
  const colorId = optionalId(input.colorId);
  if (colorId !== null) {
    const color = db.prepare('SELECT id FROM colors WHERE id = ?').get(colorId);
    if (!color) throw new ServiceError('Couleur introuvable.', 404);
  }
  const existing = db
    .prepare('SELECT id FROM coupe_rolls WHERE code = ?')
    .get(code);
  if (existing) {
    throw new ServiceError(`Le code rouleau ${code} existe déjà.`, 409);
  }
  const insert = db.transaction(() => {
    const result = db
      .prepare(
        `INSERT INTO coupe_rolls
           (code, fabric_ref, color_id, initial_weight_kg, initial_qty,
            qty_unit, remaining_weight_kg, remaining_qty,
            width_cm, usable_width_cm, grammage_g_m2, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'disponible')`,
      )
      .run(
        code,
        fabricRef,
        colorId,
        weight,
        length,
        length !== null ? 'm' : 'kg',
        weight,
        length,
        width,
        usable,
        grammage,
      );
    db.prepare(
      `INSERT INTO coupe_roll_movements
         (roll_id, movement_type, weight_before, weight_after, qty, unit, user_id)
       VALUES (?, 'creation', NULL, ?, ?, ?, ?)`,
    ).run(result.lastInsertRowid, weight, length, length !== null ? 'm' : 'kg', actor.id);
    return Number(result.lastInsertRowid);
  });
  const id = insert();
  const row = db
    .prepare(`${ROLL_SELECT} WHERE r.id = ?`)
    .get(id) as RollRow;
  return toRollItem(row);
}

export interface UpdateRollInput {
  rollId: unknown;
  fabricRef?: unknown;
  colorId?: unknown;
  lengthM?: unknown;
  widthCm?: unknown;
  usableWidthCm?: unknown;
  grammageGm2?: unknown;
}

/**
 * Modification des informations d'un rouleau DISPONIBLE (chef de coupe).
 * Le code et le poids physique (identité + contrainte 9–30 kg + suivi
 * des mouvements) ne sont pas modifiables. La longueur ne peut jamais
 * descendre sous la quantité déjà consommée.
 */
export function updateRoll(
  db: Database.Database,
  actor: Actor,
  input: UpdateRollInput,
): RollItem {
  assertCoupeWrite(actor);
  const rollId = requireId(input.rollId, 'Le rouleau');
  const row = db.prepare(`${ROLL_SELECT} WHERE r.id = ?`).get(rollId) as RollRow | undefined;
  if (!row) throw new ServiceError('Rouleau introuvable.', 404);
  if (row.status !== 'disponible') {
    throw new ServiceError(
      'Seul un rouleau disponible peut être modifié.',
      409,
    );
  }
  const fabricRef = input.fabricRef === undefined
    ? row.fabric_ref
    : requireText(input.fabricRef, 'La référence du tissu');
  let colorId = row.color_id;
  if (input.colorId !== undefined) {
    colorId = optionalId(input.colorId);
    if (colorId !== null) {
      const color = db.prepare('SELECT id FROM colors WHERE id = ?').get(colorId);
      if (!color) throw new ServiceError('Couleur introuvable.', 404);
    }
  }
  // Rouleau suivi en kg (métrage inconnu) : aucune longueur ne peut être
  // définie ici — la gestion reste légitime (référence, couleur, grammage).
  const requestedLength = input.lengthM === undefined
    ? null
    : parseNumberInput(input.lengthM);
  if (row.qty_unit !== 'm' && requestedLength !== null) {
    throw new ServiceError(
      'Rouleau suivi en kilogrammes (métrage inconnu) : la longueur ne peut '
      + 'pas être définie ici. Utilisez la correction de stock.',
      400,
    );
  }
  const consumed = row.qty_unit === 'm'
    ? (row.initial_qty ?? 0) - (row.remaining_qty ?? 0)
    : 0;
  const length = row.qty_unit === 'm'
    ? (requestedLength ?? row.initial_qty)
    : row.initial_qty;
  if (row.qty_unit === 'm' && (length === null || length <= 0)) {
    throw new ServiceError(
      'La longueur disponible en mètres est requise et doit être positive.',
      400,
    );
  }
  if (row.qty_unit === 'm' && length !== null && length < consumed) {
    throw new ServiceError(
      `La longueur ne peut pas descendre sous la quantité déjà consommée (${consumed} m).`,
      400,
    );
  }
  const width = input.widthCm === undefined
    ? row.width_cm
    : parseNumberInput(input.widthCm);
  if (width !== null && width <= 0) {
    throw new ServiceError('La largeur du tissu doit être positive.', 400);
  }
  const usable = input.usableWidthCm === undefined
    ? row.usable_width_cm
    : parseNumberInput(input.usableWidthCm);
  if (usable !== null && usable <= 0) {
    throw new ServiceError('La largeur utile du tissu doit être positive.', 400);
  }
  if (width !== null && usable !== null && usable > width) {
    throw new ServiceError(
      'La largeur utile ne peut pas dépasser la largeur du tissu.',
      400,
    );
  }
  const grammage = input.grammageGm2 === undefined
    ? row.grammage_g_m2
    : parseNumberInput(input.grammageGm2);
  if (grammage !== null && grammage <= 0) {
    throw new ServiceError('Le grammage doit être positif.', 400);
  }
  // Cohérence sur les valeurs combinées après modification : des données
  // présentées comme cohérentes ne peuvent pas être enregistrées avec un
  // écart majeur (un rouleau sans métrage ou sans grammage reste gérable).
  if (row.qty_unit === 'm' && length !== null
    && grammage !== null && width !== null
    && checkRollCoherence(row.initial_weight_kg, length, grammage, width).anomaly) {
    throw coherenceError(row.initial_weight_kg, length, grammage, width);
  }
  db.prepare(
    `UPDATE coupe_rolls
        SET fabric_ref = ?, color_id = ?, initial_qty = ?, remaining_qty = ?,
            width_cm = ?, usable_width_cm = ?, grammage_g_m2 = ?
      WHERE id = ?`,
  ).run(
    fabricRef, colorId,
    row.qty_unit === 'm' ? length : row.initial_qty,
    row.qty_unit === 'm' ? (length !== null ? length - consumed : null) : row.remaining_qty,
    width, usable, grammage, rollId,
  );
  const updated = db.prepare(`${ROLL_SELECT} WHERE r.id = ?`).get(rollId) as RollRow;
  return toRollItem(updated);
}
