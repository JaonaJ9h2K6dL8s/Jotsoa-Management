import type Database from 'better-sqlite3';
import { ServiceError } from '@/server/api/service-error';
import type { Actor } from '@/server/users/users-service';
import { parseNumberInput } from '@/lib/coupe-validation';
import type { FicheMesures } from './pattern-rules';
import {
  assertCoupePlanValidation,
  assertCoupeWrite,
  inTransaction,
  optionalId,
  requireId,
  requireText,
} from './common';
import { requireCatalogueProduct } from './catalogue';

/**
 * Fiches techniques versionnées (table `fiches_techniques`).
 * Une fiche porte les mesures réelles du produit pour une taille
 * (objet libellé → valeur en cm). Le parcours d'écriture :
 * brouillon (chef de coupe) → validé (administrateur). Une fiche
 * validée est immuable : toute modification repasse par un nouveau
 * brouillon versionné ; chaque version archivée reste consultable.
 */

export interface FicheItem {
  id: number;
  productId: number;
  sizeId: number | null;
  sizeNom: string | null;
  fabricType: string | null;
  colorNom: string | null;
  mesures: FicheMesures;
  statut: 'brouillon' | 'a_verifier' | 'valide' | 'archive';
  version: number;
  createdAt: string;
  updatedAt: string;
}

interface FicheRow {
  id: number;
  product_id: number;
  size_id: number | null;
  size_nom: string | null;
  fabric_type: string | null;
  color_nom: string | null;
  mesures_json: string;
  statut: string;
  version: number;
  created_at: string;
  updated_at: string;
}

const FICHE_STATUTS = ['brouillon', 'a_verifier', 'valide', 'archive'];

function parseMesures(raw: string): FicheMesures {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ServiceError(
      'Fiche technique : mesures illisibles. Recréez la fiche.',
      409,
    );
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ServiceError(
      'Fiche technique : format de mesures non reconnu (objet attendu).',
      409,
    );
  }
  const mesures: FicheMesures = {};
  for (const [label, value] of Object.entries(parsed as Record<string, unknown>)) {
    const num = parseNumberInput(value);
    if (!label.trim() || num === null || num < 0) {
      throw new ServiceError(
        `Fiche technique : mesure invalide « ${label} ».`,
        409,
      );
    }
    mesures[label.trim()] = num;
  }
  return mesures;
}

function toFicheItem(row: FicheRow): FicheItem {
  let mesures: FicheMesures;
  try {
    mesures = parseMesures(row.mesures_json);
  } catch {
    // Ancienne fiche au format illisible : conservée pour l'historique
    // mais sans mesures exploitables (aucun patron ne pourra en sortir).
    mesures = {};
  }
  return {
    id: row.id,
    productId: row.product_id,
    sizeId: row.size_id,
    sizeNom: row.size_nom,
    fabricType: row.fabric_type,
    colorNom: row.color_nom,
    mesures,
    statut: row.statut as FicheItem['statut'],
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_FICHE = `
  SELECT f.id, f.product_id, f.size_id, s.nom AS size_nom, f.fabric_type,
         f.color_nom, f.mesures_json, f.statut, f.version,
         f.created_at, f.updated_at
    FROM fiches_techniques f
    LEFT JOIN sizes s ON s.id = f.size_id`;

export function listFiches(
  db: Database.Database,
  filter: { productId?: number; sizeId?: number } = {},
): FicheItem[] {
  const conditions: string[] = [`f.statut IN ('brouillon','a_verifier','valide')`];
  const params: number[] = [];
  if (filter.productId) {
    conditions.push('f.product_id = ?');
    params.push(filter.productId);
  }
  if (filter.sizeId) {
    conditions.push('f.size_id = ?');
    params.push(filter.sizeId);
  }
  const rows = db
    .prepare(`${SELECT_FICHE} WHERE ${conditions.join(' AND ')} ORDER BY f.updated_at DESC, f.id DESC`)
    .all(...params) as FicheRow[];
  return rows.map(toFicheItem);
}

export function getFiche(db: Database.Database, ficheId: number): FicheItem {
  const row = db
    .prepare(`${SELECT_FICHE} WHERE f.id = ?`)
    .get(ficheId) as FicheRow | undefined;
  if (!row) throw new ServiceError('Fiche technique introuvable.', 404);
  return toFicheItem(row);
}

/** Fiche validée exigée pour toute génération de patron. */
export function requireValidatedFiche(
  db: Database.Database,
  ficheId: number,
): FicheItem {
  const fiche = getFiche(db, ficheId);
  if (fiche.statut !== 'valide') {
    throw new ServiceError(
      'La fiche technique doit être validée avant de produire un patron.',
      409,
    );
  }
  return fiche;
}

function normalizeMesuresInput(raw: unknown): FicheMesures {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ServiceError('Les mesures doivent être un objet libellé → valeur.', 400);
  }
  const mesures: FicheMesures = {};
  let count = 0;
  for (const [label, value] of Object.entries(raw as Record<string, unknown>)) {
    const clean = label.trim();
    if (!clean) {
      throw new ServiceError('Chaque mesure doit avoir un libellé non vide.', 400);
    }
    const num = parseNumberInput(value);
    if (num === null || num < 0) {
      throw new ServiceError(
        `La mesure « ${clean} » doit être un nombre positif (cm).`,
        400,
      );
    }
    if (clean.length > 80) {
      throw new ServiceError(
        `Le libellé « ${clean} » dépasse 80 caractères.`,
        400,
      );
    }
    mesures[clean] = num;
    count += 1;
  }
  if (count === 0) {
    throw new ServiceError('Au moins une mesure est requise.', 400);
  }
  return mesures;
}

export interface SaveFicheInput {
  ficheId?: number;
  productId: number;
  sizeId: unknown;
  fabricType?: unknown;
  colorNom?: unknown;
  mesures: unknown;
}

export function saveFiche(
  db: Database.Database,
  actor: Actor,
  input: SaveFicheInput,
): FicheItem {
  assertCoupeWrite(actor);
  const productId = requireId(input.productId, 'Le produit');
  const product = requireCatalogueProduct(db, productId);
  const sizeId = optionalId(input.sizeId);
  if (sizeId !== null) {
    const allowed = product.sizes.some((size) => size.id === sizeId);
    if (!allowed) {
      throw new ServiceError(
        'La taille choisie n’appartient pas à ce produit du catalogue.',
        400,
      );
    }
  }
  const mesures = normalizeMesuresInput(input.mesures);
  const fabricType =
    input.fabricType === null || input.fabricType === undefined
      ? null
      : requireText(input.fabricType, 'Le type de tissu');
  const colorNom =
    input.colorNom === null || input.colorNom === undefined
      ? null
      : requireText(input.colorNom, 'La couleur');

  return inTransaction(db, () => {
    if (input.ficheId !== undefined && input.ficheId !== null) {
      return updateDraftFiche(db, actor, requireId(input.ficheId, 'La fiche'), {
        sizeId,
        fabricType,
        colorNom,
        mesures,
      });
    }
    const result = db
      .prepare(
        `INSERT INTO fiches_techniques
           (product_id, size_id, color_nom, fabric_type, mesures_json,
            statut, version, created_by)
         VALUES (?, ?, ?, ?, ?, 'brouillon', 1, ?)`,
      )
      .run(productId, sizeId, colorNom, fabricType, JSON.stringify(mesures), actor.id);
    return getFiche(db, Number(result.lastInsertRowid));
  });
}

interface DraftPatch {
  sizeId: number | null;
  fabricType: string | null;
  colorNom: string | null;
  mesures: FicheMesures;
}

function updateDraftFiche(
  db: Database.Database,
  actor: Actor,
  ficheId: number,
  patch: DraftPatch,
): FicheItem {
  const row = db
    .prepare('SELECT * FROM fiches_techniques WHERE id = ?')
    .get(ficheId) as
    | { id: number; statut: string; version: number; mesures_json: string;
        size_id: number | null; fabric_type: string | null; color_nom: string | null }
    | undefined;
  if (!row) throw new ServiceError('Fiche technique introuvable.', 404);
  if (row.statut === 'valide' || row.statut === 'archive') {
    throw new ServiceError(
      'Une fiche validée est immuable : créez une nouvelle fiche.',
      409,
    );
  }
  const newVersion = row.version + 1;
  db.prepare(
    `INSERT INTO fiche_technique_versions
       (fiche_id, version, data_json, statut, created_by)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(ficheId, row.version, row.mesures_json, row.statut, actor.id);
  db.prepare(
    `UPDATE fiches_techniques
        SET size_id = ?, fabric_type = ?, color_nom = ?, mesures_json = ?,
            statut = 'brouillon', version = ?, validated_by = NULL,
            validated_at = NULL, updated_at = datetime('now')
      WHERE id = ?`,
  ).run(
    patch.sizeId,
    patch.fabricType,
    patch.colorNom,
    JSON.stringify(patch.mesures),
    newVersion,
    ficheId,
  );
  return getFiche(db, ficheId);
}

/** Validation définitive : chef de coupe ou administrateur. */
export function validateFiche(
  db: Database.Database,
  actor: Actor,
  ficheId: number,
): FicheItem {
  assertCoupePlanValidation(actor);
  const fiche = getFiche(db, ficheId);
  if (fiche.statut === 'valide') return fiche;
  if (fiche.statut === 'archive') {
    throw new ServiceError('Une fiche archivée ne peut pas être validée.', 409);
  }
  if (Object.keys(fiche.mesures).length === 0) {
    throw new ServiceError('Impossible de valider une fiche sans mesure.', 409);
  }
  return inTransaction(db, () => {
    db.prepare(
      `INSERT INTO fiche_technique_versions
         (fiche_id, version, data_json, statut, created_by)
       VALUES (?, ?, ?, 'valide', ?)`,
    ).run(ficheId, fiche.version, JSON.stringify(fiche.mesures), actor.id);
    db.prepare(
      `UPDATE fiches_techniques
          SET statut = 'valide', validated_by = ?,
              validated_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ?`,
    ).run(actor.id, ficheId);
    return getFiche(db, ficheId);
  });
}

export { FICHE_STATUTS };
