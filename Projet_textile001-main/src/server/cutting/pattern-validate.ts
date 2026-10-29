import type Database from 'better-sqlite3';
import { ServiceError } from '@/server/api/service-error';
import type { Actor } from '@/server/users/users-service';
import type { GrainDirection } from '@/lib/cutting/types';
import { validateContourDefects } from '@/lib/cutting/contour-validate';
import { grainPermittedRotations } from '@/lib/cutting/geometry';
import { assertCoupeAdmin, inTransaction } from './common';
import { getFiche } from './fiches';
import { requireCatalogueProduct } from './catalogue';
import { buildFamilyPieces } from './pattern-rules';
import { getRevision, type RevisionItem, type RevisionPiece } from './patterns';

/**
 * Validation finale d'une révision de patron : administrateur
 * uniquement, jamais automatique. Une révision générée est re-vérifiée
 * contre les règles de patronage (R2) et la fiche validée (immuable) : toute pièce
 * requise manquante bloque la validation. Une révision validée devient
 * immuable (triggers SQL) ; les anciennes révisions et les plans déjà
 * validés ne sont jamais touchés.
 *
 * Contrôle géométrique SERVEUR (autorité finale, jamais le navigateur) :
 * chaque contour persisté doit être fini, fermé, non dégénéré et sans
 * auto-intersection ; sa boîte englobante doit correspondre aux
 * dimensions de coupe ; les rotations doivent être des multiples de 90°
 * compatibles avec le droit-fil déclaré. Un contour invalide est rejeté
 * avec un motif explicite, sans réécrire les données existantes.
 */

const VALID_ROTATIONS = [0, 90, 180, 270];
const VALID_GRAINS: GrainDirection[] = ['along', 'cross', 'any'];

/** Défauts géométriques et droit-fil/rotations d'une pièce (libellés). */
function pieceConstraintDefects(piece: RevisionPiece): string[] {
  const problems: string[] = [];
  for (const defect of validateContourDefects(piece.points, {
    widthCm: piece.widthCm,
    heightCm: piece.heightCm,
  })) {
    problems.push(`Pièce « ${piece.label} » (${piece.code}) : ${defect.message}.`);
  }
  if (!VALID_GRAINS.includes(piece.grainDirection)) {
    problems.push(
      `Pièce « ${piece.label} » (${piece.code}) : `
      + `droit-fil « ${piece.grainDirection} » inconnu.`,
    );
  } else if (piece.allowedRotations.length === 0) {
    problems.push(
      `Pièce « ${piece.label} » (${piece.code}) : aucune rotation autorisée.`,
    );
  } else if (piece.allowedRotations.some(
    (angle) => !VALID_ROTATIONS.includes(angle),
  )) {
    problems.push(
      `Pièce « ${piece.label} » (${piece.code}) : rotations `
      + `${piece.allowedRotations.join(', ')}° invalides `
      + '(multiples de 90° uniquement).',
    );
  } else if (grainPermittedRotations(
    piece.grainDirection,
    piece.allowedRotations,
  ).length === 0) {
    problems.push(
      `Pièce « ${piece.label} » (${piece.code}) : aucune rotation `
      + `compatible avec le droit-fil « ${piece.grainDirection} ».`,
    );
  }
  return problems;
}

/** Contrôle géométrique complet de toutes les pièces d'une révision. */
function revisionGeometryDefects(revision: RevisionItem): string[] {
  return revision.pieces.flatMap((piece) => pieceConstraintDefects(piece));
}

export function validateRevision(
  db: Database.Database,
  actor: Actor,
  revisionId: number,
): RevisionItem {
  assertCoupeAdmin(actor);
  const revision = getRevision(db, revisionId);
  if (revision.status === 'valide') return revision;
  if (revision.status !== 'brouillon' && revision.status !== 'a_verifier') {
    throw new ServiceError(
      'Seule une révision en brouillon peut être validée.',
      409,
    );
  }
  if (revision.pieces.length === 0) {
    throw new ServiceError('Révision sans pièce : validation refusée.', 409);
  }
  const unusable = revision.pieces.filter(
    (piece) => piece.required && (piece.points.length < 3 || piece.widthCm <= 0),
  );
  if (unusable.length > 0) {
    const detail = unusable
      .map((piece) => `${piece.label} (à configurer)`)
      .join(', ');
    throw new ServiceError(
      `Patron incomplet, validation refusée : ${detail}.`,
      409,
    );
  }
  const geometryDefects = revisionGeometryDefects(revision);
  if (geometryDefects.length > 0) {
    throw new ServiceError(
      `Contours invalides, validation refusée : ${geometryDefects.join(' ')}`,
      409,
    );
  }
  if (!revision.modelName.startsWith('import-')) {
    const fiche = getFiche(db, revision.ficheId);
    const catalogue = requireCatalogueProduct(db, revision.productId);
    const built = buildFamilyPieces(catalogue.family, fiche.mesures);
    const missing = built.filter(
      (piece) => piece.required && piece.status === 'incomplete',
    );
    if (missing.length > 0) {
      const detail = missing
        .map((piece) => `${piece.label} : ${piece.missingLabels.join(', ')}`)
        .join(' ; ');
      throw new ServiceError(
        `Patron incomplet, validation refusée : ${detail}.`,
        409,
      );
    }
  }
  return inTransaction(db, () => {
    db.prepare(
      'UPDATE pattern_pieces SET is_validated = 1 WHERE revision_id = ?',
    ).run(revisionId);
    db.prepare(
      `UPDATE pattern_revisions
          SET status = 'valide', validated_by = ?,
              validated_at = datetime('now')
        WHERE id = ?`,
    ).run(actor.id, revisionId);
    return getRevision(db, revisionId);
  });
}
