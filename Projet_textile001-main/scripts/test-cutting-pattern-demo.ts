import { polygonArea } from '../src/lib/cutting/geometry';
import { ServiceError } from '../src/server/api/service-error';
import { buildPatternDemo, previewPatternForProduct } from '../src/server/cutting/pattern-demo';
import { listCatalogueProducts } from '../src/server/cutting/catalogue';
import { createTestDb } from './test-cutting-services';

export function runCuttingPatternDemoTests(
  check: (label: string, fn: () => void) => void,
): void {
  check('Aperçu produit : silhouettes normalisées pour les cinq familles R2', () => {
    for (const family of ['tshirt', 'polo', 'short', 'jogging', 'ensemble']) {
      const preview = buildPatternDemo(family);
      if (preview.family !== family || preview.pieces.length === 0) {
        throw new Error(`Aperçu absent pour ${family}.`);
      }
      for (const piece of preview.pieces) {
        if (piece.outline.length < 3 || polygonArea(piece.outline) <= 0) {
          throw new Error(`Contour de démonstration invalide : ${piece.code}.`);
        }
        if (piece.outline.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y)
          || point.x < 0 || point.x > 100 || point.y < 0 || point.y > 100)) {
          throw new Error(`Coordonnées de démonstration hors vue : ${piece.code}.`);
        }
        const dimensions = piece as unknown as Record<string, unknown>;
        if ('widthCm' in dimensions || 'heightCm' in dimensions || 'seamAllowanceCm' in dimensions) {
          throw new Error(`Mesures industrielles exposées dans l’aperçu : ${piece.code}.`);
        }
      }
    }
  });

  check('Aperçu produit : pièces optionnelles clairement distinctes', () => {
    const polo = buildPatternDemo('polo');
    const slit = polo.pieces.find((piece) => piece.code === 'fente_cote');
    if (!slit || slit.required || slit.qty !== 2) {
      throw new Error('La fente optionnelle du polo doit être listée par deux.');
    }
  });

  check('Aperçu produit : famille lue du catalogue sans créer de révision', () => {
    const { db } = createTestDb('cut-pattern-demo-');
    const product = listCatalogueProducts(db).find((item) => item.family === 'tshirt');
    if (!product) throw new Error('Produit T-shirt de test introuvable.');
    const before = (db.prepare('SELECT COUNT(*) AS count FROM pattern_revisions').get() as { count: number }).count;
    const preview = previewPatternForProduct(db, product.productId);
    const after = (db.prepare('SELECT COUNT(*) AS count FROM pattern_revisions').get() as { count: number }).count;
    if (preview.family !== product.family || before !== after) {
      throw new Error('L’aperçu ne suit pas le produit ou a écrit une révision.');
    }
  });

  check('Aperçu produit : famille inconnue refusée explicitement', () => {
    try {
      buildPatternDemo('veste');
      throw new Error('Une famille sans règle de démonstration a été acceptée.');
    } catch (error) {
      if (!(error instanceof ServiceError) || error.status !== 400) throw error;
    }
  });
}
