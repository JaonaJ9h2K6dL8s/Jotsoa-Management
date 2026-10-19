/**
 * Préparation des fiches techniques et patrons validés pour les tests
 * du workflow Coupe. Réutilisé par test-coupe-workflow.ts.
 */

import type { Actor } from '../src/server/users/users-service';

interface SizeRef {
  id: number;
  nom: string;
}

/** Crée une fiche validée + révision de patron validée par taille. */
export async function seedValidatedPatterns(
  CHEF: Actor,
  productId: number,
  sizes: SizeRef[],
): Promise<void> {
  const patternLibrary = await import('../src/server/coupe/pattern-library');
  const fiches = await import('../src/server/coupe/fiches');
  for (const size of sizes) {
    const fiche = fiches.saveFiche(CHEF, {
      productId,
      sizeId: size.id,
      colorNom: 'Blanc',
      modele: 'Polo WF',
      coupe: 'droite',
      fabricType: 'COTON-180',
      composition: '100% coton',
      grammageGm2: 180,
      largeurRouleauCm: 180,
      largeurUtileCm: 160,
      mesures: [{ label: 'Longueur totale', valeurCm: 70 }],
      confection: {},
    });
    fiches.validateFiche(CHEF, fiche.id);
    const piece = (
      code: string,
      label: string,
      role: string,
      width: number,
      height: number,
      qty: number,
    ) => ({
      code,
      label,
      role,
      component: 'principal',
      width,
      height,
      qty,
      seamAllowanceCm: 1,
      grain: 'along',
      rotations: [0],
      seamIncluded: true,
      points: [
        [0, 0],
        [width, 0],
        [width, height],
        [0, height],
      ],
    });
    const revision = patternLibrary.importRevision(CHEF, {
      ficheId: fiche.id,
      sourceName: `polo-wf-${size.nom}.svg`,
      unit: 'cm',
      scaleVerified: true,
      pieces: [
        piece('DEVANT', 'Devant', 'devant', 40, 25, 1),
        piece('DOS', 'Dos', 'dos', 40, 25, 1),
        piece('MANCHE', 'Manche', 'manche', 20, 15, 2),
      ],
    });
    patternLibrary.validateRevision(CHEF, revision.id);
  }
}
