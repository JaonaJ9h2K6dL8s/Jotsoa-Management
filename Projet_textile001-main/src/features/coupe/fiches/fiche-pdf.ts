import { jsPDF } from 'jspdf';
import type { FicheDetail } from '@/server/coupe/fiches';
import {
  drawPlacementIntoDoc,
  placementCaption,
  type PlacementPlan,
} from './plan-placement';

/**
 * Fiche technique PDF A4 (cahier §21/§22) : données réellement
 * enregistrées uniquement — champ absent → « Non renseigné ». La
 * section 5 dessine le plan de placement validé du produit (§22.A).
 */

const M = 16; // marge (mm)
const PAGE_W = 210;
const CONTENT_W = PAGE_W - M * 2;

function sanitize(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '-');
}

export function ficheFileName(fiche: FicheDetail, duplicata = false): string {
  const ref = fiche.productNom.toUpperCase().replace(/\s+/g, '_');
  const size = (fiche.sizeNom ?? 'UNI').toUpperCase().replace(/\s+/g, '');
  const suffix = duplicata ? '_DUPLICATA' : '';
  return `FT_${ref}_${size}_V${String(fiche.version).padStart(2, '0')}${suffix}.pdf`;
}

function sectionTitle(doc: jsPDF, y: number, title: string): number {
  doc.setFillColor(27, 125, 95);
  doc.rect(M, y, CONTENT_W, 6.5, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text(title.toUpperCase(), M + 2, y + 4.5);
  doc.setTextColor(30, 30, 30);
  return y + 10;
}

function fieldRows(
  doc: jsPDF,
  y: number,
  rows: Array<[string, string]>,
): number {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  for (const [label, value] of rows) {
    doc.setDrawColor(210);
    doc.setFillColor(250, 251, 250);
    doc.rect(M, y, CONTENT_W, 6, 'FD');
    doc.setDrawColor(225);
    doc.line(M + 62, y, M + 62, y + 6);
    doc.setTextColor(90);
    doc.text(label, M + 2, y + 4);
    doc.setTextColor(25);
    doc.text(value || 'Non renseigné', M + 65, y + 4, { maxWidth: CONTENT_W - 68 });
    y += 6;
    if (y > 275) {
      doc.addPage();
      y = M;
    }
  }
  return y + 3;
}

function mesuresTable(doc: jsPDF, y: number, fiche: FicheDetail): number {
  doc.setFontSize(8.5);
  doc.setDrawColor(180);
  doc.setFillColor(240, 245, 243);
  doc.rect(M, y, 84, 6, 'FD');
  doc.rect(M + 84, y, 42, 6, 'FD');
  doc.rect(M + 126, y, 42, 6, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.text('Mesure', M + 2, y + 4);
  doc.text('Valeur (cm)', M + 86, y + 4);
  doc.text('Tolérance (cm)', M + 128, y + 4);
  y += 6;
  doc.setFont('helvetica', 'normal');
  for (const m of fiche.mesures) {
    doc.setDrawColor(220);
    doc.rect(M, y, 84, 5.5, 'D');
    doc.rect(M + 84, y, 42, 5.5, 'D');
    doc.rect(M + 126, y, 42, 5.5, 'D');
    doc.text(m.label, M + 2, y + 3.8);
    doc.text(String(m.valeurCm), M + 86, y + 3.8);
    doc.text(m.toleranceCm == null ? '—' : String(m.toleranceCm), M + 128, y + 3.8);
    y += 5.5;
    if (y > 275) {
      doc.addPage();
      y = M;
    }
  }
  return y + 4;
}

export function buildFichePdf(
  fiche: FicheDetail,
  duplicata = false,
  plan: PlacementPlan | null = null,
): jsPDF {
  if (plan && (plan.status !== 'valide' || !plan.result?.fiches?.some((snapshot) => snapshot.id === fiche.id && snapshot.version === fiche.version))) plan = null;
  const doc = new jsPDF({ format: 'a4' });
  let y = M;

  // En-tête entreprise
  doc.setFillColor(27, 125, 95);
  doc.rect(0, 0, PAGE_W, 20, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('JO MANAGEMENT', M, 11);
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.text('FICHE TECHNIQUE PRODUIT', M, 16.5);
  doc.setFontSize(9);
  doc.text(
    `${duplicata ? 'DUPLICATA — ' : ''}Version V${String(fiche.version).padStart(2, '0')}`,
    PAGE_W - M,
    11,
    { align: 'right' },
  );
  doc.text(`Édité le ${new Date().toLocaleString('fr-FR')}`, PAGE_W - M, 16.5, {
    align: 'right',
  });
  doc.setTextColor(30, 30, 30);
  y = 26;

  y = sectionTitle(doc, y, '1. Identification');
  y = fieldRows(doc, y, [
    ['Référence du produit', fiche.productNom],
    ['Taille', fiche.sizeNom ?? 'Non renseigné'],
    ['Couleur', fiche.colorNom ?? ''],
    ['Modèle / coupe', [fiche.modele, fiche.coupe].filter(Boolean).join(' / ')],
    ['Statut de validation', fiche.statut],
    ['Auteur', fiche.createdByName ?? ''],
    ['Créée le', fiche.createdAt],
    ['Dernière modification', fiche.updatedAt],
  ]);

  y = sectionTitle(doc, y, '2. Matière première');
  y = fieldRows(doc, y, [
    ['Type de tissu', fiche.fabricType ?? ''],
    ['Composition', fiche.composition ?? ''],
    ['Grammage', fiche.grammageGm2 == null ? '' : `${fiche.grammageGm2} g/m²`],
    [
      'Largeur rouleau / utile',
      [
        fiche.largeurRouleauCm == null ? null : `${fiche.largeurRouleauCm} cm`,
        fiche.largeurUtileCm == null ? null : `${fiche.largeurUtileCm} cm`,
      ]
        .filter(Boolean)
        .join(' / '),
    ],
    ['Élasticité', fiche.elasticite ?? ''],
    ['Sens du droit-fil', fiche.droitFil ?? ''],
  ]);

  y = sectionTitle(doc, y, '3. Dimensions du vêtement fini (cm)');
  y = fiche.mesures.length > 0 ? mesuresTable(doc, y, fiche) : y;
  if (fiche.mesures.length === 0) {
    doc.setFontSize(8.5);
    doc.text('Non renseigné — tableau de mesures à saisir.', M + 2, y + 4);
    y += 10;
  }

  y = sectionTitle(doc, y, '4. Patron et composants');
  y = fieldRows(
    doc,
    y,
    fiche.patrons.length === 0
      ? [['Pièces de patron', 'Aucune pièce enregistrée']]
      : fiche.patrons.map((p) => [
          `${p.pieceLabel} (x${p.qtyMultiplier})`,
          `${p.widthCm} × ${p.heightCm} cm — ${p.surfaceCm2} cm² — ${
            p.isValide ? 'validé' : 'non validé'
          }`,
        ]),
  );

  // §22.D : image du placement — page dédiée si l'espace est insuffisant.
  y = sectionTitle(doc, y, '5. Plan de placement des patrons sur la table de coupe');
  if (!plan || !plan.result || plan.result.placements.length === 0) {
    y = fieldRows(doc, y, [
      [
        'Plan de placement',
        'Plan de placement non disponible pour cette fiche/version. Générez et validez un plan, ou choisissez une production précise dans Préparation.',
      ],
    ]);
  } else {
    const needed = 145;
    if (y + needed > 279) {
      doc.addPage();
      y = M;
      y = sectionTitle(doc, y, 'Plan de placement des patrons (suite)');
    }
    const drawH = 68;
    doc.setDrawColor(180);
    doc.rect(M, y, CONTENT_W, drawH, 'S');
    drawPlacementIntoDoc(doc, plan, M, y, CONTENT_W, drawH);
    y += drawH + 3;
    const cap = placementCaption(plan);
    y = fieldRows(doc, y, [
      ['Produit / plan', `${cap.produit} — ${cap.version}`],
      ['Table de coupe', cap.table],
      ['Matelas (longueur × largeur utile) / couches', `${cap.matelas} — ${cap.couches} couche(s)`],
      ['Tailles placées (taille:qté)', cap.tailles],
      ['Taux d’utilisation théorique', cap.efficacite],
      [
        'Échelle',
        'Image proportionnelle au plan validé — échelle d’impression non contractuelle.',
      ],
    ]);
  }

  y = sectionTitle(doc, y, '6. Confection');
  y = fieldRows(doc, y, [
    [
      'Valeurs de couture',
      fiche.confection.valeursCoutureCm == null
        ? ''
        : `${fiche.confection.valeursCoutureCm} cm`,
    ],
    ['Consignes d’assemblage', fiche.confection.consignes ?? ''],
    ['Finitions', fiche.confection.finitions ?? ''],
    ['Accessoires', fiche.confection.accessoires ?? ''],
  ]);

  y = sectionTitle(doc, y, '7. Consommation');
  y = fieldRows(doc, y, [
    [
      'Consommation théorique',
      fiche.consommationTheoriqueM == null
        ? ''
        : `${fiche.consommationTheoriqueM} m par vêtement`,
    ],
    ['Observations / pertes', fiche.notes ?? ''],
  ]);

  // Pied de page : pagination
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i += 1) {
    doc.setPage(i);
    doc.setFontSize(7.5);
    doc.setTextColor(120);
    doc.text(
      `Fiche technique ${fiche.productNom} — V${String(fiche.version).padStart(2, '0')} — ${
        fiche.statut
      }`,
      M,
      290,
    );
    doc.text(`Page ${i}/${pages}`, PAGE_W - M, 290, { align: 'right' });
  }
  return doc;
}

/** Dernier plan validé du produit de la fiche (null si aucun). */
export async function fetchPlacementPlan(
  fiche: FicheDetail,
): Promise<PlacementPlan | null> {
  try {
    const response = await fetch(
      `/api/coupe/marker?latestForProduct=${fiche.productId}&ficheId=${fiche.id}&ficheVersion=${fiche.version}`,
      { cache: 'no-store' },
    );
    const body = (await response.json()) as {
      status: string;
      item?: PlacementPlan | null;
    };
    if (!response.ok) return null;
    return body.item ?? null;
  } catch {
    return null;
  }
}

export async function downloadFichePdf(
  fiche: FicheDetail,
  duplicata = false,
): Promise<void> {
  const plan = await fetchPlacementPlan(fiche);
  buildFichePdf(fiche, duplicata, plan).save(ficheFileName(fiche, duplicata));
}

export async function printFichePdf(
  fiche: FicheDetail,
  duplicata = false,
): Promise<void> {
  const plan = await fetchPlacementPlan(fiche);
  const doc = buildFichePdf(fiche, duplicata, plan);
  doc.autoPrint();
  const url = doc.output('bloburl');
  window.open(url, '_blank');
}
