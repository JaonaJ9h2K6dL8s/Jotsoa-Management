/**
 * Cas de tests Magasinier — partie 1 : sécurité des rôles, import PDF
 * (valide, partiel, scanné), doublons, correspondance et validation.
 */

import type { ActorStub, MgCaseContext, MgTestTools } from './magasinier-test-tools';

export interface ImportCaseResult {
  order1: { id: number; code: string; lines: Array<{ id: number; sizeId: number | null }> };
  order3: { id: number; code: string; lines: Array<{ id: number; sizeId: number | null }> };
}

type OrdersModule = typeof import('../src/server/magasinier/orders');

export async function runImportCases(
  ctx: MgCaseContext,
  tools: MgTestTools,
): Promise<ImportCaseResult> {
  const { db, ServiceError, MG, ST, productId, colorId, sizeIds } = ctx;
  const { check, rejectsService, name } = tools;
  const documents = await import('../src/server/magasinier/documents');
  const orders: OrdersModule = await import('../src/server/magasinier/orders');
  const preparations = await import('../src/server/magasinier/preparations');
  const [sizeM, sizeL] = sizeIds;

  name('Sécurité des rôles');
  check('un chef_stock ne peut pas consulter les commandes (403)', () => {
    let threw = false;
    try {
      orders.listOrders(ST as never);
    } catch (error) {
      threw = error instanceof ServiceError && error.status === 403;
    }
    if (!threw) throw new Error('Accès autorisé à tort.');
  });
  await rejectsService(
    () => preparations.reserveStock(ST as never, { orderId: 1, items: [] }),
    403,
  );
  console.log('  ✔ un chef_stock ne peut pas réserver du stock (403)');

  name('Import des PDF');
  await rejectsService(
    () =>
      documents.importDocument(MG as never, {
        name: 'faux.pdf',
        buffer: Buffer.from('contenu non PDF'),
      }),
    400,
  );
  console.log('  ✔ rejet d’un fichier non PDF (400)');

  const { makePdf } = await import('./magasinier-test-tools');
  const orderPdf = makePdf([
    'Commande n° : MG-EXT-2026-001',
    'Date : 2026-03-01',
    'Client : Boutique Nord',
    'T-Shirt Premium MG / Bleu / M / 8',
    'T-Shirt Premium MG / Bleu / L / 9',
  ]);
  const import1 = await documents.importDocument(MG as never, {
    name: 'commande-001.pdf',
    buffer: orderPdf,
  });
  check('import PDF valide : extraction réussie, 2 lignes', () => {
    if (import1.status !== 'extraction_ok' || import1.lines.length !== 2) {
      throw new Error(`Statut ${import1.status}, lignes ${import1.lines.length}`);
    }
    if (import1.orderNo !== 'MG-EXT-2026-001' || import1.clientName !== 'Boutique Nord') {
      throw new Error('Champs d’en-tête mal extraits.');
    }
  });
  const order1 = orders
    .listOrders(MG as never)
    .find((item) => item.documentCode === import1.code)!;
  check('commande créée avec lignes reconnues au catalogue', () => {
    if (order1.status !== 'a_verifier') throw new Error(`Statut ${order1.status}`);
    const allRecognized = order1.lines.every((line) => line.matchStatus === 'reconnu');
    const correctProduct = order1.lines.every((line) => line.productId === productId);
    const correctSizes = order1.lines.map((line) => line.sizeId).join(',');
    if (!allRecognized || !correctProduct || correctSizes !== `${sizeM},${sizeL}`) {
      throw new Error('Correspondance catalogue incorrecte.');
    }
  });

  await rejectsService(
    () =>
      documents.importDocument(MG as never, {
        name: 'commande-001-bis.pdf',
        buffer: orderPdf,
      }),
    409,
  );
  console.log('  ✔ même fichier réimporté : doublon refusé (409)');

  const dupPdf = makePdf([
    'Commande n° : MG-EXT-2026-001',
    'Date : 2026-03-02',
    'Client : Boutique Nord',
    'T-Shirt Premium MG / Bleu / M / 8',
    'T-Shirt Premium MG / Bleu / L / 9',
  ]);
  const import2 = await documents.importDocument(MG as never, {
    name: 'commande-001-copie.pdf',
    buffer: dupPdf,
  });
  const order2 = orders
    .listOrders(MG as never)
    .find((item) => item.documentCode === import2.code)!;
  check('autre PDF, même commande externe : doublon signalé', () => {
    if (!import2.message.includes('existe déjà')) {
      throw new Error('Doublon de numéro externe non signalé.');
    }
    if (!order2.duplicateWarning) {
      throw new Error('Aucun avertissement de doublon sur la commande.');
    }
  });
  await rejectsService(() => orders.validateOrder(MG as never, { orderId: order2.id }), 409);
  console.log('  ✔ validation refusée sur un doublon potentiel (409)');

  const partialPdf = makePdf(['Bonjour, veuillez trouver ci-joint notre demande.']);
  const import3 = await documents.importDocument(MG as never, {
    name: 'commande-libre.pdf',
    buffer: partialPdf,
  });
  check('texte sans lignes exploitables : extraction partielle', () => {
    if (import3.status !== 'extraction_partielle') {
      throw new Error(`Statut ${import3.status}`);
    }
  });
  documents.createManualOrder(MG as never, {
    documentId: String(import3.documentId),
    clientName: 'Boutique Sud',
    externalOrderNo: 'MG-EXT-2026-002',
    lines: [
      { rawText: 'T-Shirt Premium MG / Bleu / M / 5', qty: 5 },
      { rawText: 'T-Shirt Premium MG / Bleu / L / 6', qty: 6 },
    ],
  });
  const order3 = orders
    .listOrders(MG as never)
    .find((item) => item.externalOrderNo === 'MG-EXT-2026-002')!;
  check('saisie manuelle : lignes non reconnues en attente d’association', () => {
    if (!order3 || order3.lines.length !== 2) throw new Error('Commande manuelle absente.');
    if (!order3.lines.every((line) => line.matchStatus === 'non_reconnu')) {
      throw new Error('Lignes marquées reconnues à tort.');
    }
  });

  const scannedPdf = makePdf([]);
  const import4 = await documents.importDocument(MG as never, {
    name: 'scan.pdf',
    buffer: scannedPdf,
  });
  check('PDF scanné : OCR indisponible, saisie manuelle proposée', () => {
    if (import4.status !== 'ocr_indisponible') {
      throw new Error(`Statut ${import4.status}`);
    }
  });

  name('Correspondance et validation');
  await rejectsService(() => orders.validateOrder(MG as never, { orderId: order3.id }), 409);
  console.log('  ✔ validation refusée tant qu’une ligne reste non reconnue (409)');
  for (const line of order3.lines) {
    orders.matchOrderLine(MG as never, {
      lineId: line.id,
      productId,
      colorId,
      sizeId: line.rawText?.includes('/ L /') ? sizeL : sizeM,
    });
  }
  orders.addOrderLine(MG as never, {
    orderId: order3.id,
    rawText: 'Ligne bonus',
    qty: 1,
  });
  const bonusLine = orders
    .getOrder(MG as never, order3.id)
    .lines.find((line) => line.rawText === 'Ligne bonus')!;
  orders.removeOrderLine(MG as never, { lineId: bonusLine.id });
  orders.validateOrder(MG as never, { orderId: order3.id });
  check('association manuelle puis validation de la commande manuelle', () => {
    const validated = orders.getOrder(MG as never, order3.id);
    if (validated.status !== 'valide') throw new Error(`Statut ${validated.status}`);
  });

  orders.validateOrder(MG as never, { orderId: order1.id });
  console.log('  ✔ commande importée validée');

  void db;
  return { order1, order3 };
}

export type { ActorStub };
