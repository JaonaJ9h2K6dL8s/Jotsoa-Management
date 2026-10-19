import { sessionsDb } from '@/server/auth/sessions';
import { ServiceError } from '@/server/api/service-error';
import type { Actor } from '@/server/users/users-service';
import { bounds, geometryError, polygonArea, type Point } from '@/lib/coupe-geometry';
import { addHistory, normalizeText, requireCoupe, requireId } from './common';
import { getFiche } from './fiches';
import { requireTechnicalProduct } from './technical-catalogue';

export interface RevisionDetail {
  id: number; productId: number; sizeId: number; sizeNom: string; modelName: string; fabricRef: string;
  version: number; ficheId: number; ficheVersion: number; sourceName: string; scaleVerified: boolean;
  status: 'brouillon' | 'a_verifier' | 'valide' | 'archive';
  pieces: Array<{ id: number; code: string; label: string; component: string; role: string; points: Point[];
    widthCm: number; heightCm: number; areaCm2: number; qty: number; rotations: number[]; grain: string; seamIncluded: boolean }>;
}

export function listRevisions(actor: Actor, productId?: number): RevisionDetail[] {
  requireCoupe(actor);
  const db = sessionsDb();
  const rows = db.prepare(`SELECT r.*,s.nom size_nom FROM pattern_revisions r JOIN sizes s ON s.id = r.size_id
    WHERE (? IS NULL OR r.product_id = ?) ORDER BY r.id DESC`).all(productId ?? null, productId ?? null) as Array<Record<string, unknown>>;
  return rows.map((row) => {
    const pieces = db.prepare('SELECT * FROM pattern_pieces WHERE revision_id = ? ORDER BY id').all(row.id) as Array<Record<string, unknown>>;
    return { id: Number(row.id), productId: Number(row.product_id), sizeId: Number(row.size_id), sizeNom: String(row.size_nom),
      modelName: String(row.model_name), fabricRef: String(row.fabric_ref), version: Number(row.version), ficheId: Number(row.fiche_id),
      ficheVersion: Number(row.fiche_version), sourceName: String(row.source_name), scaleVerified: row.scale_verified === 1,
      status: row.status as RevisionDetail['status'], pieces: pieces.map((piece) => {
        const geometry = JSON.parse(String(piece.geometry_json)) as { points: number[][] };
        const points = geometry.points.map(([x, y]) => ({ x, y }));
        return { id: Number(piece.id), code: String(piece.piece_code), label: String(piece.piece_label), component: String(piece.component), role: String(piece.role_code),
          points, widthCm: Number(piece.width_cm), heightCm: Number(piece.height_cm), areaCm2: polygonArea(points), qty: Number(piece.qty_multiplier),
          rotations: JSON.parse(String(piece.allowed_rotations)) as number[], grain: String(piece.grain_direction), seamIncluded: piece.seam_included === 1 };
      }) };
  });
}

function text(raw: unknown, label: string, max = 80): string {
  const value = normalizeText(raw, max);
  if (!value) throw new ServiceError(`${label} obligatoire.`, 400);
  return value;
}

export function importRevision(actor: Actor, input: Record<string, unknown>): RevisionDetail {
  requireCoupe(actor);
  const db = sessionsDb();
  const fiche = getFiche(actor, requireId(input.ficheId, 'Fiche technique'));
  if (!fiche.sizeId || !fiche.modele || !fiche.fabricType) throw new ServiceError('Renseignez la taille, le modèle et le tissu de la fiche avant l’import.', 400);
  const product = requireTechnicalProduct(actor, fiche.productId, [fiche.sizeId]);
  const sourceName = text(input.sourceName, 'Référence du fichier source', 200);
  const unit = text(input.unit, 'Unité');
  if (!['mm', 'cm'].includes(unit)) throw new ServiceError('Unité réelle attendue : mm ou cm. Les pixels ne définissent pas une échelle industrielle.', 400);
  const factor = unit === 'mm' ? 0.1 : 1;
  if (!Array.isArray(input.pieces) || input.pieces.length < 1 || input.pieces.length > 80) throw new ServiceError('Importez de 1 à 80 contours réels.', 400);
  const codes = new Set<string>();
  const pieces = input.pieces.map((raw: unknown) => {
    if (!raw || typeof raw !== 'object') throw new ServiceError('Pièce invalide.', 400);
    const piece = raw as Record<string, unknown>;
    const code = text(piece.code, 'Code pièce');
    if (codes.has(code)) throw new ServiceError(`Code pièce dupliqué : ${code}.`, 400);
    codes.add(code);
    const label = text(piece.label, 'Nom pièce');
    const role = text(piece.role, 'Rôle pièce');
    const component = text(piece.component, 'Composant');
    if (!(product.family === 'ensemble' ? ['haut', 'short'] : ['principal']).includes(component)) throw new ServiceError('Composant incompatible : un ensemble doit distinguer haut et short.', 400);
    if (!['devant', 'dos', 'manche', 'col', 'patte', 'ceinture', 'poche', 'poignet', 'autre'].includes(role)) throw new ServiceError('Rôle de pièce inconnu.', 400);
    if (!Array.isArray(piece.points)) throw new ServiceError(`Contour absent : ${label}.`, 400);
    let points: Point[] = piece.points.map((point: unknown) => {
      if (!Array.isArray(point) || point.length !== 2 || point.some((coordinate) => typeof coordinate !== 'number')) throw new ServiceError('Coordonnées attendues : [x, y] numériques.', 400);
      return { x: point[0] * factor, y: point[1] * factor };
    });
    if (points.length > 3 && points[0].x === points.at(-1)?.x && points[0].y === points.at(-1)?.y) points = points.slice(0, -1);
    const error = geometryError(points);
    if (error) throw new ServiceError(`${label} : ${error}`, 400);
    const box = bounds(points);
    const expectedWidth = Number(piece.width) * factor;
    const expectedHeight = Number(piece.height) * factor;
    if (![expectedWidth, expectedHeight].every(Number.isFinite) || Math.abs(box.width - expectedWidth) > 0.02 || Math.abs(box.height - expectedHeight) > 0.02) throw new ServiceError(`${label} : dimensions de contrôle absentes ou échelle incompatible avec le contour.`, 400);
    const qty = Number(piece.qty);
    const allowance = Number(piece.seamAllowanceCm);
    if (!Number.isInteger(qty) || qty < 1 || qty > 20) throw new ServiceError('Nombre de pièces par vêtement invalide (1 à 20).', 400);
    if (piece.seamAllowanceCm == null || !Number.isFinite(allowance) || allowance < 0 || allowance > 10) throw new ServiceError('Valeur de couture explicite requise (cm).', 400);
    const grain = text(piece.grain, 'Droit-fil');
    if (!['along', 'cross', 'any'].includes(grain)) throw new ServiceError('Droit-fil invalide.', 400);
    if (!Array.isArray(piece.rotations) || !piece.rotations.length || piece.rotations.some((rotation) => ![0,90,180,270].includes(rotation))) throw new ServiceError('Rotations explicites requises parmi 0, 90, 180, 270 degrés.', 400);
    if (typeof piece.seamIncluded !== 'boolean') throw new ServiceError('Indiquez si les coutures sont intégrées au contour.', 400);
    const marks = piece.marks ?? [];
    if (!Array.isArray(marks) || marks.length > 200 || marks.some((mark) => !Array.isArray(mark) || mark.length !== 2 || mark.some((value) => !Number.isFinite(value)))) throw new ServiceError('Repères invalides : coordonnées [x,y] attendues.', 400);
    return { code, label, role, component, points, box, qty, allowance, grain, rotations: [...new Set(piece.rotations)], seamIncluded: piece.seamIncluded, marks };
  });
  const id = db.transaction(() => {
    const latest = db.prepare(`SELECT COALESCE(MAX(version),0) version FROM pattern_revisions WHERE product_id=? AND size_id=? AND model_name=? AND fabric_ref=?`)
      .get(fiche.productId, fiche.sizeId, fiche.modele, fiche.fabricType) as { version: number };
    const result = db.prepare(`INSERT INTO pattern_revisions (product_id,size_id,model_name,fabric_ref,version,fiche_id,fiche_version,source_name,source_unit,scale_verified,created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(fiche.productId, fiche.sizeId, fiche.modele, fiche.fabricType, latest.version + 1, fiche.id, fiche.version, sourceName, unit, input.scaleVerified === true ? 1 : 0, actor.id);
    const revisionId = Number(result.lastInsertRowid);
    for (const piece of pieces) {
      db.prepare(`INSERT INTO pattern_pieces (product_id,category,piece_code,piece_label,size_id,version,geometry_json,width_cm,height_cm,qty_multiplier,grain_direction,allowed_rotations,seam_allowance_cm,is_validated,revision_id,component,role_code,seam_included,marks_json)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,?)`).run(fiche.productId, product.category, piece.code, piece.label, fiche.sizeId, `R${revisionId}-V${latest.version + 1}`,
        JSON.stringify({ points: piece.points.map((point) => [point.x,point.y]) }), piece.box.width, piece.box.height, piece.qty, piece.grain, JSON.stringify(piece.rotations),
        piece.allowance, revisionId, piece.component, piece.role, piece.seamIncluded ? 1 : 0, JSON.stringify(piece.marks.map((mark) => (mark as number[]).map((value) => value * factor))));
    }
    addHistory(db, { action: 'PATTERN_IMPORTED', entityType: 'pattern_revision', entityId: revisionId, actorId: actor.id, newValue: { sourceName, unit, ficheId: fiche.id, version: latest.version + 1 } });
    return revisionId;
  }).immediate();
  return listRevisions(actor, fiche.productId).find((revision) => revision.id === id)!;
}

export function validateRevision(actor: Actor, rawId: unknown): RevisionDetail {
  requireCoupe(actor);
  const db = sessionsDb();
  const id = requireId(rawId, 'Révision');
  db.transaction(() => {
    const revision = listRevisions(actor).find((item) => item.id === id);
    if (!revision) throw new ServiceError('Révision introuvable.', 404);
    if (['valide','archive'].includes(revision.status)) throw new ServiceError('Cette révision est déjà approuvée ou archivée.', 409);
    if (!revision.scaleVerified) throw new ServiceError('Échelle non vérifiée : réimportez après contrôle physique des dimensions.', 400);
    const fiche = getFiche(actor, revision.ficheId);
    if (fiche.statut !== 'valide' || fiche.version !== revision.ficheVersion || !fiche.mesures.length || fiche.mesures.some((measure) => measure.valeurCm <= 0)) throw new ServiceError('Dimensions officielles absentes, non validées ou modifiées depuis l’import.', 409);
    if (fiche.modele !== revision.modelName || fiche.fabricType !== revision.fabricRef || fiche.sizeId !== revision.sizeId) throw new ServiceError('La fiche a changé : réimportez les patrons pour la bonne combinaison.', 409);
    const product = requireTechnicalProduct(actor, revision.productId, [revision.sizeId]);
    const required: Array<[string, string[]]> = product.family === 'ensemble'
      ? [['haut', ['devant','dos','manche']], ['short', ['devant','dos','ceinture']]]
      : [['principal', product.family === 'tshirt' ? ['devant','dos','manche'] : product.family === 'polo' ? ['devant','dos','manche','col','patte'] : ['devant','dos','ceinture']]];
    for (const [component, roles] of required) for (const role of roles) {
      if (!revision.pieces.some((piece) => piece.component === component && piece.role === role)) throw new ServiceError(`Pièce obligatoire absente : ${component} / ${role}.`, 400);
    }
    const unprepared = db.prepare('SELECT piece_label FROM pattern_pieces WHERE revision_id=? AND seam_included=0 AND seam_allowance_cm>0').all(id) as Array<{piece_label: string}>;
    if (unprepared.length) throw new ServiceError(`Contours sans valeurs de couture intégrées : ${unprepared.map((piece) => piece.piece_label).join(', ')}. Importez les contours de coupe ; aucune surépaisseur automatique approximative.`, 400);
    for (const piece of revision.pieces) {
      const rotations = piece.rotations.filter((rotation) => piece.grain === 'any' || (piece.grain === 'along' ? [0,180] : [90,270]).includes(rotation));
      if (!rotations.length) throw new ServiceError(`Rotations incompatibles avec le droit-fil : ${piece.label}.`, 400);
    }
    db.prepare('UPDATE pattern_pieces SET is_validated=1,validated_by=?,validated_at=datetime(\'now\') WHERE revision_id=?').run(actor.id,id);
    db.prepare(`UPDATE pattern_revisions SET status='valide',fiche_snapshot_json=?,validated_by=?,validated_at=datetime('now') WHERE id=?`)
      .run(JSON.stringify(fiche),actor.id,id);
    addHistory(db,{action:'PATTERN_VALIDATED',entityType:'pattern_revision',entityId:id,actorId:actor.id,newValue:{ficheId:fiche.id,ficheVersion:fiche.version}});
  }).immediate();
  return listRevisions(actor).find((item) => item.id === id)!;
}

export function archiveRevision(actor: Actor, rawId: unknown): void {
  requireCoupe(actor);
  const id = requireId(rawId,'Révision');
  const db = sessionsDb();
  db.transaction(() => {
    const updated = db.prepare("UPDATE pattern_revisions SET status='archive' WHERE id=? AND status='valide'").run(id);
    if (!updated.changes) throw new ServiceError('Seule une révision validée peut être archivée.',409);
    addHistory(db,{action:'PATTERN_ARCHIVED',entityType:'pattern_revision',entityId:id,actorId:actor.id});
  }).immediate();
}
