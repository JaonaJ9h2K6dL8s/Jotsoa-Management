/**
 * Orchestrateur des cas de tests du module Chef Magasinier.
 * Partie 1 : sécurité, import PDF, doublons, correspondance.
 * Partie 2 : réservations, cartons, vérification, dossiers.
 */

import { createMgTestTools } from './magasinier-test-tools';
import type { MgCaseContext } from './magasinier-test-tools';
import { runImportCases } from './test-magasinier-import';
import { runPreparationCases } from './test-magasinier-preparation';

export async function runMagasinierCases(ctx: MgCaseContext): Promise<void> {
  const tools = createMgTestTools(ctx.ServiceError);
  const importResults = await runImportCases(ctx, tools);
  await runPreparationCases(ctx, tools, importResults);
}
