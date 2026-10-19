import { jsPDF } from 'jspdf';
import type { TicketDetail } from '@/server/coupe/tickets';

/**
 * Impression des tickets de production (cahier §20.B/§20.D) : format
 * thermique 80 mm ou A4, QR code contrasté, mention DUPLICATA sur les
 * réimpressions. Champs non pertinents masqués — aucune donnée
 * inventée : ce qui n'est pas fourni n'est pas affiché.
 */

type Format = 'thermique' | 'a4';

function fieldsOf(ticket: TicketDetail): Array<[string, string]> {
  const payload = ticket.payload as Record<string, string | number | null | undefined>;
  const rows: Array<[string, string]> = [];
  const push = (label: string, value: unknown) => {
    if (value !== null && value !== undefined && String(value).trim() !== '') {
      rows.push([label, String(value)]);
    }
  };
  push('Lot de coupe', ticket.lotCode);
  push('Référence opération', ticket.refOperation);
  push('Produit', payload.produit);
  push('Modèle / coupe', [payload.modele, payload.coupe].filter(Boolean).join(' / '));
  push('Catégorie', payload.categorie);
  push('Taille', payload.taille);
  push('Couleur', payload.couleur);
  push('Tissu', payload.tissu);
  push(
    'Grammage / lot',
    [payload.grammage, payload.lotTissu].filter(Boolean).join(' / '),
  );
  push('Quantité prévue', payload.qtePrevue);
  push('Quantité coupée', payload.qteCoupee);
  push('Quantité transférée', payload.qteTransferee);
  push('Couches du matelas', payload.couches);
  push('Table de coupe', payload.tableCoupe);
  push('Observations', ticket.observations);
  return rows;
}

function baseLines(doc: jsPDF, ticket: TicketDetail, duplicata: boolean): void {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('JO MANAGEMENT', doc.internal.pageSize.getWidth() / 2, 9, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  const label =
    ticket.type === 'coupe'
      ? 'TICKET DE COUPE'
      : ticket.type === 'transfert'
        ? 'TICKET DE TRANSFERT — COUTURE'
        : 'TICKET DE SUIVI';
  doc.text(label, doc.internal.pageSize.getWidth() / 2, 14, { align: 'center' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text(ticket.code, doc.internal.pageSize.getWidth() / 2, 19, { align: 'center' });
  if (duplicata) {
    doc.setFontSize(8);
    doc.setTextColor(200, 60, 40);
    doc.text('DUPLICATA', doc.internal.pageSize.getWidth() / 2, 23.5, { align: 'center' });
    doc.setTextColor(0, 0, 0);
  }
}

export function ticketFileName(ticket: TicketDetail, duplicata = false): string {
  return `${ticket.code}${duplicata ? '_DUPLICATA' : ''}.pdf`;
}

export function buildTicketPdf(
  ticket: TicketDetail,
  format: Format,
  duplicata = false,
): jsPDF {
  const doc =
    format === 'thermique'
      ? new jsPDF({ unit: 'mm', format: [80, 160] })
      : new jsPDF({ unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  baseLines(doc, ticket, duplicata);
  let y = duplicata ? 28 : 24;

  // QR code contrasté, taille suffisante (§20.C).
  doc.addImage(ticket.qrDataUrl, 'PNG', W / 2 - 16, y, 32, 32);
  y += 35;
  doc.setFontSize(7.5);
  doc.setTextColor(90);
  doc.text(`Code lisible : ${ticket.code}`, W / 2, y, { align: 'center' });
  doc.setTextColor(0, 0, 0);
  y += 4;

  doc.setDrawColor(200);
  doc.line(6, y, W - 6, y);
  y += 4;
  doc.setFont('helvetica', 'normal');
  for (const [label, value] of fieldsOf(ticket)) {
    doc.setFontSize(8);
    doc.setTextColor(90);
    doc.text(label, 6, y + 3);
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'bold');
    doc.text(String(value).slice(0, 42), 32, y + 3, { maxWidth: W - 38 });
    doc.setFont('helvetica', 'normal');
    y += 5.5;
  }

  y += 2;
  doc.setDrawColor(200);
  doc.line(6, y, W - 6, y);
  y += 4;
  doc.setFontSize(7.5);
  doc.setTextColor(90);
  doc.text(`Créé le ${ticket.createdAt}`, 6, y + 3);
  doc.text(ticket.createdByName ?? '', W - 6, y + 3, { align: 'right' });
  y += 5.5;
  if (ticket.reprintCount > 0) {
    doc.text(
      `Réimpressions : ${ticket.reprintCount}${
        ticket.lastReprintAt ? ` — dernière : ${ticket.lastReprintAt}` : ''
      }`,
      6,
      y + 3,
    );
    y += 5.5;
  }
  doc.setTextColor(0, 0, 0);
  return doc;
}

export function downloadTicketPdf(
  ticket: TicketDetail,
  format: Format,
  duplicata = false,
): void {
  buildTicketPdf(ticket, format, duplicata).save(ticketFileName(ticket, duplicata));
}

export function printTicketPdf(
  ticket: TicketDetail,
  format: Format,
  duplicata = false,
): void {
  const doc = buildTicketPdf(ticket, format, duplicata);
  doc.autoPrint();
  window.open(doc.output('bloburl'), '_blank');
}
