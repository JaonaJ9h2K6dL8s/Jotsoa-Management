import { ServiceError } from '@/server/api/service-error';
import type { Actor } from '@/server/users/users-service';
import { requireId } from './common';
import { getFiche } from './fiches';
import { requireTechnicalProduct } from './technical-catalogue';
import { importRevision, type RevisionDetail } from './pattern-library';
import {
  buildFamilyPieces,
  PATTERN_RULES_VERSION,
  type MesuresBag,
} from './pattern-rules';

/**
 * Générateur automatique de patrons vectoriels (étape 3).
 *
 * Chaîne de responsabilité :
 *  - fiche technique validée obligatoirement (§4 : sans dimensions
 *    validées, aucun patron) ;
 *  - mesures officielles du catalogue technique : chaque libellé requis
 *    par la famille doit exister avec une valeur > 0 — aucune valeur
 *    arbitraire n'est substituée (règle absolue §60.1) ;
 *  - règles de patronage versionnées (pattern-rules.ts) qui construisent
 *    les contours de coupe, coutures intégrées ;
 *  - conversion vers le format d'import existant et création d'une
 *    révision en brouillon via importRevision : le générateur ne
 *    valide jamais automatiquement (§5), la validation reste humaine
 *    via validateRevision.
 *
 * Traçabilité : sourceName GEN-<FAMILLE>-<categorie>-<version règles>
 * relie la révision aux mesures sources et à la version des règles.
 */

export interface GeneratedPieceSummary {
  code: string;
  label: string;
  component: string;
  role: string;
  qty: number;
  widthCm: number;
  heightCm: number;
}

export interface GenerateResult {
  revisionId: number;
  version: number;
  status: RevisionDetail['status'];
  sourceName: string;
  rulesVersion: string;
  seamAllowanceCm: number;
  pieces: GeneratedPieceSummary[];
  notice: string;
}

type FicheDetail = ReturnType<typeof getFiche>;

function resolveAllowance(fiche: FicheDetail, raw: unknown): number {
  const value = Number(raw ?? fiche.confection.valeursCoutureCm);
  if (!Number.isFinite(value) || value < 0 || value > 10) {
    throw new ServiceError(
      'Marge de couture explicite requise (cm), entre 0 et 10 : renseignez le paramètre de génération ou la valeur de couture de la fiche.',
      400,
    );
  }
  return value;
}

function measuresBag(actor: Actor, fiche: FicheDetail): {
  bag: MesuresBag;
  product: ReturnType<typeof requireTechnicalProduct>;
} {
  const product = requireTechnicalProduct(actor, fiche.productId, [fiche.sizeId!]);
  const bag: MesuresBag = {};
  for (const measure of fiche.mesures) bag[measure.label] = measure.valeurCm;
  const missing = product.measurements.filter(
    (label) => !(Number.isFinite(bag[label]) && bag[label] > 0),
  );
  if (missing.length) {
    throw new ServiceError(
      `Mesures officielles manquantes sur la fiche : ${missing.join(', ')}. Complétez puis validez la fiche avant la génération.`,
      400,
    );
  }
  return { bag, product };
}

/**
 * Génère les pièces d'une famille pour la taille de la fiche.
 * La révision créée reste en brouillon : elle doit passer
 * validateRevision (contrôles des pièces obligatoires, échelle,
 * cohérence fiche) avant d'être utilisable par le placement.
 */
export function generatePatterns(
  actor: Actor,
  input: { ficheId: unknown; seamAllowanceCm?: unknown },
): GenerateResult {
  const ficheId = requireId(input.ficheId, 'Fiche technique');
  const fiche = getFiche(actor, ficheId);
  if (fiche.statut !== 'valide') {
    throw new ServiceError(
      'La fiche technique doit être validée avant la génération des patrons.',
      409,
    );
  }
  if (!fiche.sizeId) {
    throw new ServiceError('Renseignez la taille de la fiche avant la génération.', 400);
  }
  const allowance = resolveAllowance(fiche, input.seamAllowanceCm);
  const { bag, product } = measuresBag(actor, fiche);

  // Règles versionnées : erreurs explicites pour mesure absente,
  // incohérence ou famille non disponible (ex. polo, hauteur de col).
  const drafts = buildFamilyPieces(product.family, bag, allowance);

  // scaleVerified : les contours sont calculés en centimètres à
  // l'échelle exacte des mesures validées — aucune mise à l'échelle
  // n'est appliquée entre les mesures et les coordonnées.
  const sourceName = `GEN-${product.family.toUpperCase()}-${product.category}-${PATTERN_RULES_VERSION}`;
  const revision = importRevision(actor, {
    ficheId,
    sourceName,
    unit: 'cm',
    scaleVerified: true,
    pieces: drafts.map((draft) => ({
      code: draft.code,
      label: draft.label,
      role: draft.role,
      component: draft.component,
      points: draft.points.map((point) => [point.x, point.y]),
      width: draft.widthCm,
      height: draft.heightCm,
      qty: draft.qty,
      seamAllowanceCm: draft.seamAllowanceCm,
      grain: draft.grain,
      rotations: draft.rotations,
      seamIncluded: draft.seamIncluded,
      marks: [],
    })),
  });

  return {
    revisionId: revision.id,
    version: revision.version,
    status: revision.status,
    sourceName,
    rulesVersion: PATTERN_RULES_VERSION,
    seamAllowanceCm: allowance,
    pieces: revision.pieces.map((piece) => ({
      code: piece.code,
      label: piece.label,
      component: piece.component,
      role: piece.role,
      qty: piece.qty,
      widthCm: piece.widthCm,
      heightCm: piece.heightCm,
    })),
    notice:
      'Patrons générés en brouillon à partir des mesures validées de la fiche. Vérifiez les contours puis validez la révision pour les rendre utilisables par le placement.',
  };
}
