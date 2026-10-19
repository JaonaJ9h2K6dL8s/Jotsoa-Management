/**
 * Outils des tests du module Chef Magasinier : assertions, PDF de
 * test minimal (lisible par unpdf) et types partagés.
 */

import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import type { ServiceError as ServiceErrorType } from '../src/server/api/service-error';

export interface ActorStub {
  id: number;
  roleCode: string;
}

export interface MgCaseContext {
  db: Database.Database;
  ServiceError: typeof ServiceErrorType;
  MG: ActorStub;
  ST: ActorStub;
  productId: number;
  colorId: number;
  sizeIds: number[];
  cartonIds: number[];
}

export interface MgTestTools {
  passed: { count: number };
  check: (label: string, fn: () => void) => void;
  rejectsService: (fn: () => Promise<unknown> | unknown, status: number) => Promise<void>;
  name: (label: string) => void;
}

export function createMgTestTools(
  ServiceError: typeof ServiceErrorType,
): MgTestTools {
  const passed = { count: 0 };
  return {
    passed,
    check(label, fn) {
      fn();
      passed.count += 1;
      console.log(`  ✔ ${label}`);
    },
    async rejectsService(fn, status) {
      let threw = false;
      try {
        await fn();
      } catch (error) {
        threw = true;
        if (!(error instanceof ServiceError) || error.status !== status) {
          throw error;
        }
      }
      if (!threw) {
        throw new Error(`Aucune erreur levée (statut attendu ${status}).`);
      }
      passed.count += 1;
    },
    name(label) {
      console.log(label);
    },
  };
}

/** PDF minimal valide avec un flux de texte simple (lecture par unpdf). */
export function makePdf(textLines: string[]): Buffer {
  const esc = (value: string) =>
    value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const content = [
    'BT /F1 12 Tf 50 760 Td 16 TL',
    ...textLines.map((line) => `(${esc(line)}) Tj T*`),
    'ET',
  ].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

export function sha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}
