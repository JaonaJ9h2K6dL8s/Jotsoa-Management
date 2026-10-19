/**
 * Test §22 : génère la fiche technique PDF AVEC l'image du plan de
 * placement validé + le plan de placement seul. Sortie dans docs/.
 * Exécution : npx tsx scripts/test-plan-pdf.ts
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { buildFichePdf, ficheFileName } from '../src/features/coupe/fiches/fiche-pdf';
import { buildPlacementPdf } from '../src/features/coupe/fiches/plan-placement';
import type { MarkerPlanRow } from '../src/server/coupe/marker';
import type { FicheDetail } from '../src/server/coupe/fiches';

const ROOT = path.resolve(__dirname, '..');
const db = new Database(path.join(ROOT, 'data', 'jo-test-admin.db'), { readonly: true });

// --- Plan validé ---
const planRow = db
  .prepare(
    `SELECT mp.*, p.nom AS product_name, ct.nom AS coupe_table_nom
     FROM marker_plans mp JOIN products p ON p.id = mp.product_id
     LEFT JOIN coupe_tables ct ON ct.id = mp.coupe_table_id
     WHERE mp.status = 'valide' ORDER BY mp.id DESC LIMIT 1`,
  )
  .get() as never as Record<string, unknown>;
if (!planRow) throw new Error('Aucun plan validé');
const plan: MarkerPlanRow = {
  id: Number(planRow.id),
  lotId: (planRow.lot_id as number | null) ?? null,
  productId: Number(planRow.product_id),
  productName: String(planRow.product_name),
  category: planRow.category as 'adulte' | 'enfant',
  usableWidthCm: Number(planRow.usable_width_cm),
  matelasLengthCm: Number(planRow.matelas_length_cm),
  layers: Number(planRow.layers),
  gapCm: Number(planRow.gap_cm),
  grammageGm2: (planRow.grammage_g_m2 as number | null) ?? null,
  markerLengthCm: Number(planRow.marker_length_cm),
  totalPieces: Number(planRow.total_pieces),
  placedAreaM2: Number(planRow.placed_area_m2),
  availableAreaM2: Number(planRow.available_area_m2),
  efficiency: Number(planRow.efficiency),
  wasteAreaM2: Number(planRow.waste_area_m2),
  wasteKgEst: (planRow.waste_kg_est as number | null) ?? null,
  status: 'valide',
  createdBy: Number(planRow.created_by),
  createdByName: null,
  createdAt: String(planRow.created_at),
  coupeTableId: (planRow.coupe_table_id as number | null) ?? null,
  coupeTableNom: (planRow.coupe_table_nom as string | null) ?? null,
  sizes: JSON.parse(String(planRow.sizes_json)),
  result: JSON.parse(String(planRow.pieces_json)),
};
console.log(
  `Plan MK-${plan.id} : ${plan.result?.placements.length} placements, efficacité ${plan.efficiency} %`,
);

// --- Fiche technique (id=1) ---
const fRow = db
  .prepare(
    `SELECT f.*, p.nom AS product_nom, s.nom AS size_nom, u.nom || ' ' || u.prenom AS author
     FROM fiches_techniques f
     JOIN products p ON p.id = f.product_id
     LEFT JOIN sizes s ON s.id = f.size_id
     JOIN users u ON u.id = f.created_by WHERE f.id = 1`,
  )
  .get() as never as Record<string, unknown>;
const fiche: FicheDetail = {
  id: Number(fRow.id),
  productId: Number(fRow.product_id),
  productNom: String(fRow.product_nom),
  sizeId: (fRow.size_id as number | null) ?? null,
  sizeNom: (fRow.size_nom as string | null) ?? null,
  colorNom: (fRow.color_nom as string | null) ?? null,
  modele: (fRow.modele as string | null) ?? null,
  coupe: (fRow.coupe as string | null) ?? null,
  fabricType: (fRow.fabric_type as string | null) ?? null,
  composition: (fRow.composition as string | null) ?? null,
  grammageGm2: (fRow.grammage_g_m2 as number | null) ?? null,
  largeurRouleauCm: (fRow.largeur_rouleau_cm as number | null) ?? null,
  largeurUtileCm: (fRow.largeur_utile_cm as number | null) ?? null,
  elasticite: (fRow.elasticite as string | null) ?? null,
  droitFil: (fRow.droit_fil as string | null) ?? null,
  mesures: JSON.parse(String(fRow.mesures_json ?? '[]')),
  confection: JSON.parse(String(fRow.confection_json ?? '{}')),
  consommationTheoriqueM: (fRow.consommation_theorique_m as number | null) ?? null,
  statut: fRow.statut as FicheDetail['statut'],
  version: Number(fRow.version),
  notes: (fRow.notes as string | null) ?? null,
  createdByName: (fRow.author as string | null) ?? null,
  createdAt: String(fRow.created_at),
  updatedAt: String(fRow.updated_at),
  patrons: [],
  versions: [],
};

fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
const ficheDoc = buildFichePdf(fiche, false, plan);
const fichePath = path.join(ROOT, 'docs', ficheFileName(fiche));
fs.writeFileSync(fichePath, Buffer.from(ficheDoc.output('arraybuffer')));
console.log('Fiche avec plan :', fichePath, fs.statSync(fichePath).size, 'octets');

const planDoc = buildPlacementPdf(plan);
const planPath = path.join(
  ROOT,
  'docs',
  `PLAN_PLACEMENT_${plan.productName.toUpperCase().replace(/\s+/g, '_')}_MK${String(plan.id).padStart(4, '0')}.pdf`,
);
fs.writeFileSync(planPath, Buffer.from(planDoc.output('arraybuffer')));
console.log('Plan de placement seul :', planPath, fs.statSync(planPath).size, 'octets');
db.close();
console.log('OK');
