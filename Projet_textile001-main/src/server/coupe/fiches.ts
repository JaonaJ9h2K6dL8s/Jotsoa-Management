import { sessionsDb } from '@/server/auth/sessions';
import { ServiceError } from '@/server/api/service-error';
import type { Actor } from '@/server/users/users-service';
import { addHistory, requireCoupe, requireId, normalizeText } from './common';
import { polygonArea } from '@/lib/coupe-geometry';

/**
 * Fiches techniques (cahier §3 et §21) : uniquement des valeurs
 * enregistrées en base — jamais de valeurs codées en dur. Les
 * dimensions restent indicatives jusqu'à validation par le chef de
 * coupe ; chaque modification d'une fiche validée archéficie
 * l'ancienne version (§21.E).
 */

export interface FicheMesure {
  label: string;
  valeurCm: number;
  toleranceCm?: number;
}

export interface FicheConfection {
  valeursCoutureCm?: number | null;
  consignes?: string | null;
  finitions?: string | null;
  accessoires?: string | null;
}

export interface FicheDetail {
  id: number;
  productId: number;
  productNom: string;
  sizeId: number | null;
  sizeNom: string | null;
  colorNom: string | null;
  modele: string | null;
  coupe: string | null;
  fabricType: string | null;
  composition: string | null;
  grammageGm2: number | null;
  largeurRouleauCm: number | null;
  largeurUtileCm: number | null;
  elasticite: string | null;
  droitFil: string | null;
  mesures: FicheMesure[];
  confection: FicheConfection;
  consommationTheoriqueM: number | null;
  statut: 'brouillon' | 'a_verifier' | 'valide' | 'archive';
  version: number;
  notes: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  patrons: Array<{
    pieceCode: string;
    pieceLabel: string;
    sizeNom: string | null;
    widthCm: number;
    heightCm: number;
    surfaceCm2: number;
    qtyMultiplier: number;
    isValide: boolean;
  }>;
  versions: Array<{
    version: number;
    statut: string;
    createdByName: string | null;
    createdAt: string;
  }>;
}

const SELECT_FICHE = `
  SELECT f.*, p.nom AS product_nom, s.nom AS size_nom,
         u.nom || ' ' || u.prenom AS author_name
  FROM fiches_techniques f
  JOIN products p ON p.id = f.product_id
  LEFT JOIN sizes s ON s.id = f.size_id
  JOIN users u ON u.id = f.created_by
`;

function loadFiche(db: ReturnType<typeof sessionsDb>, id: number): FicheDetail {
  const row = db.prepare(`${SELECT_FICHE} WHERE f.id = ?`).get(id) as
    | (Record<string, unknown> & { id: number })
    | undefined;
  if (!row) throw new ServiceError('Fiche technique introuvable.', 404);
  return mapFiche(db, row);
}

function mapFiche(
  db: ReturnType<typeof sessionsDb>,
  row: Record<string, unknown>,
): FicheDetail {
  const patrons = db
    .prepare(
      `SELECT pp.piece_code, pp.piece_label, pp.width_cm, pp.height_cm, pp.geometry_json,
              pp.qty_multiplier, pp.is_validated, s.nom AS size_nom
       FROM pattern_pieces pp
       JOIN pattern_revisions revision ON revision.id = pp.revision_id
       LEFT JOIN sizes s ON s.id = pp.size_id
       WHERE pp.product_id = ? AND (? IS NULL OR pp.size_id = ?)
         AND revision.fiche_id = ? AND revision.fiche_version = ? AND revision.status != 'archive'
       ORDER BY pp.piece_code`,
    )
    .all(
      row.product_id,
      row.size_id ?? null,
      row.size_id ?? null,
      row.id,
      row.version,
    ) as Array<{
    geometry_json: string;
    piece_code: string;
    piece_label: string;
    width_cm: number;
    height_cm: number;
    qty_multiplier: number;
    is_validated: number;
    size_nom: string | null;
  }>;

  const versions = db
    .prepare(
      `SELECT v.version, v.statut, v.created_at,
              u.nom || ' ' || u.prenom AS author
       FROM fiche_technique_versions v
       JOIN users u ON u.id = v.created_by
       WHERE v.fiche_id = ? ORDER BY v.version DESC`,
    )
    .all(row.id) as Array<{
    version: number;
    statut: string;
    created_at: string;
    author: string | null;
  }>;

  return {
    id: Number(row.id),
    productId: Number(row.product_id),
    productNom: String(row.product_nom ?? ''),
    sizeId: row.size_id == null ? null : Number(row.size_id),
    sizeNom: (row.size_nom as string | null) ?? null,
    colorNom: (row.color_nom as string | null) ?? null,
    modele: (row.modele as string | null) ?? null,
    coupe: (row.coupe as string | null) ?? null,
    fabricType: (row.fabric_type as string | null) ?? null,
    composition: (row.composition as string | null) ?? null,
    grammageGm2: (row.grammage_g_m2 as number | null) ?? null,
    largeurRouleauCm: (row.largeur_rouleau_cm as number | null) ?? null,
    largeurUtileCm: (row.largeur_utile_cm as number | null) ?? null,
    elasticite: (row.elasticite as string | null) ?? null,
    droitFil: (row.droit_fil as string | null) ?? null,
    mesures: JSON.parse(String(row.mesures_json ?? '[]')) as FicheMesure[],
    confection: JSON.parse(String(row.confection_json ?? '{}')) as FicheConfection,
    consommationTheoriqueM: (row.consommation_theorique_m as number | null) ?? null,
    statut: row.statut as FicheDetail['statut'],
    version: Number(row.version),
    notes: (row.notes as string | null) ?? null,
    createdByName: (row.author_name as string | null) ?? null,
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
    patrons: patrons.map((p) => ({
      pieceCode: p.piece_code,
      pieceLabel: p.piece_label,
      sizeNom: p.size_nom,
      widthCm: p.width_cm,
      heightCm: p.height_cm,
      surfaceCm2: polygonArea((JSON.parse(p.geometry_json) as { points: number[][] }).points.map(([x, y]) => ({ x, y }))),
      qtyMultiplier: p.qty_multiplier,
      isValide: p.is_validated === 1,
    })),
    versions: versions.map((v) => ({
      version: v.version,
      statut: v.statut,
      createdByName: v.author,
      createdAt: v.created_at,
    })),
  };
}

export function listFiches(actor: Actor): FicheDetail[] {
  requireCoupe(actor);
  const db = sessionsDb();
  const rows = db.prepare(`${SELECT_FICHE} ORDER BY p.nom, s.nom`).all() as Array<
    Record<string, unknown> & { id: number }
  >;
  return rows.map((row) => mapFiche(db, row));
}

export function getFiche(actor: Actor, id: number): FicheDetail {
  requireCoupe(actor);
  return loadFiche(sessionsDb(), requireId(id, 'Fiche'));
}

export interface FicheInput {
  id?: number | null;
  productId: unknown;
  sizeId?: unknown;
  colorNom?: unknown;
  modele?: unknown;
  coupe?: unknown;
  fabricType?: unknown;
  composition?: unknown;
  grammageGm2?: unknown;
  largeurRouleauCm?: unknown;
  largeurUtileCm?: unknown;
  elasticite?: unknown;
  droitFil?: unknown;
  mesures?: unknown;
  confection?: unknown;
  consommationTheoriqueM?: unknown;
  notes?: unknown;
}

function numOrNull(raw: unknown, label: string): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new ServiceError(`${label} invalide.`, 400);
  }
  return value;
}

export function saveFiche(actor: Actor, body: FicheInput): FicheDetail {
  requireCoupe(actor);
  return sessionsDb().transaction(() => saveFicheData(actor, body)).immediate();
}

function saveFicheData(actor: Actor, body: FicheInput): FicheDetail {
  requireCoupe(actor);
  const db = sessionsDb();
  const productId = requireId(body.productId, 'Produit');
  const product = db
    .prepare('SELECT id FROM products WHERE id = ? AND is_active = 1')
    .get(productId) as { id: number } | undefined;
  if (!product) throw new ServiceError('Produit introuvable ou désactivé.', 400);

  const mesures = (Array.isArray(body.mesures) ? body.mesures : []).map((m) => {
    const item = m as { label?: unknown; valeurCm?: unknown; toleranceCm?: unknown };
    const label = normalizeText(item.label, 80);
    const valeur = numOrNull(item.valeurCm, 'Valeur de mesure');
    if (!label || valeur == null) {
      throw new ServiceError('Mesure incomplète (libellé + valeur).', 400);
    }
    return {
      label,
      valeurCm: valeur,
      toleranceCm: numOrNull(item.toleranceCm, 'Tolérance') ?? undefined,
    };
  });
  const confection = (body.confection ?? {}) as FicheConfection;

  if (body.id) {
    const ficheId = requireId(body.id, 'Fiche');
    const current = loadFiche(db, ficheId);
    // Modification d'une fiche validée : archive puis bump de version.
    let version = current.version;
    if (current.statut === 'valide') {
      db.prepare(
        `INSERT INTO fiche_technique_versions
           (fiche_id, version, data_json, statut, created_by)
         VALUES (?, ?, ?, 'archive', ?)`,
      ).run(ficheId, current.version, JSON.stringify(current), actor.id);
      version += 1;
    }
    db.prepare(
      `UPDATE fiches_techniques SET
         size_id = ?, color_nom = ?, modele = ?, coupe = ?, fabric_type = ?,
         composition = ?, grammage_g_m2 = ?, largeur_rouleau_cm = ?,
         largeur_utile_cm = ?, elasticite = ?, droit_fil = ?,
         mesures_json = ?, confection_json = ?, consommation_theorique_m = ?,
         statut = 'a_verifier', version = ?, notes = ?, updated_at = datetime('now')
       WHERE id = ?`,
    ).run(
      body.sizeId == null || body.sizeId === '' ? null : requireId(body.sizeId, 'Taille'),
      normalizeText(body.colorNom, 40),
      normalizeText(body.modele, 60),
      normalizeText(body.coupe, 40),
      normalizeText(body.fabricType, 80),
      normalizeText(body.composition, 200),
      numOrNull(body.grammageGm2, 'Grammage'),
      numOrNull(body.largeurRouleauCm, 'Largeur du rouleau'),
      numOrNull(body.largeurUtileCm, 'Largeur utile'),
      normalizeText(body.elasticite, 120),
      normalizeText(body.droitFil, 120),
      JSON.stringify(mesures),
      JSON.stringify(confection),
      numOrNull(body.consommationTheoriqueM, 'Consommation théorique'),
      version,
      normalizeText(body.notes, 500),
      ficheId,
    );
    addHistory(db, {
      action: 'update',
      entityType: 'fiche_technique',
      entityId: ficheId,
      actorId: actor.id,
      newValue: { version, mesures: mesures.length },
    });
    return loadFiche(db, ficheId);
  }

  const info = db
    .prepare(
      `INSERT INTO fiches_techniques
         (product_id, size_id, color_nom, modele, coupe, fabric_type, composition,
          grammage_g_m2, largeur_rouleau_cm, largeur_utile_cm, elasticite, droit_fil,
          mesures_json, confection_json, consommation_theorique_m, statut,
          version, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'brouillon', 1, ?, ?)`,
    )
    .run(
      productId,
      body.sizeId == null || body.sizeId === '' ? null : requireId(body.sizeId, 'Taille'),
      normalizeText(body.colorNom, 40),
      normalizeText(body.modele, 60),
      normalizeText(body.coupe, 40),
      normalizeText(body.fabricType, 80),
      normalizeText(body.composition, 200),
      numOrNull(body.grammageGm2, 'Grammage'),
      numOrNull(body.largeurRouleauCm, 'Largeur du rouleau'),
      numOrNull(body.largeurUtileCm, 'Largeur utile'),
      normalizeText(body.elasticite, 120),
      normalizeText(body.droitFil, 120),
      JSON.stringify(mesures),
      JSON.stringify(confection),
      numOrNull(body.consommationTheoriqueM, 'Consommation théorique'),
      normalizeText(body.notes, 500),
      actor.id,
    );
  const ficheId = Number(info.lastInsertRowid);
  addHistory(db, {
    action: 'create',
    entityType: 'fiche_technique',
    entityId: ficheId,
    actorId: actor.id,
  });
  return loadFiche(db, ficheId);
}

export function validateFiche(actor: Actor, id: number): FicheDetail {
  requireCoupe(actor);
  return sessionsDb().transaction(() => validateFicheData(actor, id)).immediate();
}

function validateFicheData(actor: Actor, id: number): FicheDetail {
  requireCoupe(actor);
  const db = sessionsDb();
  const ficheId = requireId(id, 'Fiche');
  const current = loadFiche(db, ficheId);
  // §4 : sans dimension validée, la validation du patron est bloquée.
  if (current.mesures.length === 0) {
    throw new ServiceError(
      'Aucune dimension enregistrée : saisissez le tableau de mesures avant de valider la fiche.',
      400,
    );
  }
  if (current.statut === 'valide') throw new ServiceError('Fiche déjà validée.', 409);
  if (current.mesures.some((measure) => measure.valeurCm <= 0)) {
    throw new ServiceError('Toutes les dimensions doivent être strictement positives.', 400);
  }
  db.prepare(
    `UPDATE fiches_techniques
     SET statut = 'valide', validated_by = ?, validated_at = datetime('now'),
         updated_at = datetime('now')
     WHERE id = ?`,
  ).run(actor.id, ficheId);
  addHistory(db, {
    action: 'validate',
    entityType: 'fiche_technique',
    entityId: ficheId,
    actorId: actor.id,
    newValue: { version: current.version },
  });
  return loadFiche(db, ficheId);
}
