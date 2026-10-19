import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import type { SectionReport } from './report-types';

/**
 * Exports Excel et PDF, générés depuis les mêmes services de calcul
 * que l'interface (aucune divergence graphique ↔ fichier). Cellules
 * protégées contre l'injection de formules.
 */

/** Neutralise les débuts de formule dans les cellules texte. */
function safeCell(value: string | number | null): string | number {
  if (typeof value === 'string' && /^[=+@]/.test(value)) {
    return `'${value}`;
  }
  return value ?? '';
}

export function buildWorkbook(
  report: SectionReport,
  filtersSummary: string,
): Buffer {
  const wb = XLSX.utils.book_new();
  const info: Array<[string, string]> = [
    ['Rapport', report.title],
    ['Période', report.periodLabel],
    ['Période de comparaison', report.previousLabel],
    ['Filtres', filtersSummary || 'aucun'],
    ['Généré le', new Date().toISOString().slice(0, 16).replace('T', ' ')],
  ];
  const infoSheet = XLSX.utils.aoa_to_sheet([
    ['JO Management — Rapport'],
    ...info,
    [],
    ['Notes', ...report.notes],
  ]);
  XLSX.utils.book_append_sheet(wb, infoSheet, 'Information');
  for (const reportTable of report.tables) {
    const header = reportTable.columns.map((column) => column.label);
    const rows = reportTable.rows.map((row) =>
      reportTable.columns.map((column) => safeCell(row[column.key] ?? null)),
    );
    const sheet = XLSX.utils.aoa_to_sheet([
      [reportTable.label],
      ...(reportTable.note ? [[reportTable.note]] : []),
      header,
      ...rows,
    ]);
    const name = reportTable.key.slice(0, 30).replace(/[\\/?*[\]:]/g, '_');
    XLSX.utils.book_append_sheet(wb, sheet, name);
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export function buildPdf(report: SectionReport, filtersSummary: string): Buffer {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const margin = 40;
  const width = doc.internal.pageSize.getWidth() - margin * 2;
  let y = margin;
  doc.setFontSize(16);
  doc.text('JO Management — Rapport', margin, y);
  y += 24;
  doc.setFontSize(13);
  doc.text(report.title, margin, y);
  y += 18;
  doc.setFontSize(9);
  doc.text(`Période : ${report.periodLabel}`, margin, y);
  y += 14;
  doc.text(`Comparaison : ${report.previousLabel}`, margin, y);
  y += 14;
  doc.text(`Filtres : ${filtersSummary || 'aucun'}`, margin, y);
  y += 14;
  doc.text(`Généré le : ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`, margin, y);
  y += 20;
  doc.setFontSize(11);
  doc.text('Indicateurs', margin, y);
  y += 16;
  doc.setFontSize(8);
  for (const kpi of report.kpis) {
    const delta =
      kpi.previous === null
        ? 'indicateur d’instant'
        : kpi.deltaPercent === null
          ? `précédent : ${kpi.previous} (${kpi.unit}) — variation absolue ${kpi.delta ?? 0}`
          : `précédent : ${kpi.previous} — variation ${(kpi.delta ?? 0) >= 0 ? '+' : ''}${kpi.deltaPercent.toFixed(1)} %`;
    const lines = doc.splitTextToSize(
      `${kpi.label} : ${kpi.value} ${kpi.unit} — ${delta}`,
      width,
    );
    for (const line of lines) {
      if (y > doc.internal.pageSize.getHeight() - margin) {
        doc.addPage();
        y = margin;
      }
      doc.text(line, margin, y);
      y += 11;
    }
  }
  y += 8;
  for (const reportTable of report.tables) {
    if (reportTable.rows.length === 0) continue;
    doc.setFontSize(10);
    if (y > doc.internal.pageSize.getHeight() - margin - 60) {
      doc.addPage();
      y = margin;
    }
    doc.text(reportTable.label, margin, y);
    y += 14;
    doc.setFontSize(7.5);
    const shown = reportTable.rows.slice(0, 20);
    for (const row of shown) {
      const text = reportTable.columns
        .map((column) => {
          const value = row[column.key];
          const formatted =
            column.numeric && typeof value === 'number'
              ? String(Math.round(value * 100) / 100)
              : String(value ?? '');
          return `${column.label} : ${formatted}`;
        })
        .join(' | ');
      const lines = doc.splitTextToSize(text, width);
      for (const line of lines) {
        if (y > doc.internal.pageSize.getHeight() - margin) {
          doc.addPage();
          y = margin;
        }
        doc.text(line, margin, y);
        y += 10;
      }
    }
    if (reportTable.rows.length > shown.length) {
      doc.text(`… ${reportTable.rows.length - shown.length} ligne(s) supplémentaire(s) dans l’export Excel.`, margin, y);
      y += 10;
    }
    y += 8;
  }
  doc.setFontSize(8);
  for (const note of report.notes) {
    if (y > doc.internal.pageSize.getHeight() - margin) {
      doc.addPage();
      y = margin;
    }
    const lines = doc.splitTextToSize(`Note : ${note}`, width);
    for (const line of lines) {
      doc.text(line, margin, y);
      y += 11;
    }
  }
  return Buffer.from(doc.output('arraybuffer'));
}
