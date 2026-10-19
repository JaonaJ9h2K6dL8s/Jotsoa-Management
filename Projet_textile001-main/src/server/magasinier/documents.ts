import crypto from 'node:crypto';
import { ServiceError } from '@/server/api/service-error';
import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import { raiseAlert } from '@/server/alerts/alerts';
import type {
  MgDocumentDTO,
  MgExtractResultDTO,
} from '@/types/magasinier';
import {
  addMgHistory,
  nextMgCode,
  normalizeText,
  pdfLimits,
  requireMagasinier,
  requireText,
} from './common';
import { parseOrderText } from './parser';
import { createOrderInternal } from './order-creation';

/**
 * Import des PDF de commandes : extraction de texte via unpdf, aucun
 * contenu actif exécuté, limites de taille et de pages configurables
 * dans app_meta. Un PDF scanné (sans texte) est signalé explicitement
 * : l'OCR n'est pas disponible, la saisie manuelle reste possible.
 * Les doublons sont détectés par empreinte et par numéro de commande.
 */

interface DocumentRow {
  id: number;
  code: string;
  file_name: string;
  sha256: string;
  size_bytes: number;
  page_count: number | null;
  status: MgDocumentDTO['status'];
  external_order_no: string | null;
  imported_by_name: string | null;
  imported_at: string;
  notes: string | null;
  extracted_text: string | null;
  order_id: number | null;
  order_code: string | null;
}

const DOCUMENT_SELECT = `
  SELECT d.*, u.nom || ' ' || u.prenom AS imported_by_name,
         o.id AS order_id, o.code AS order_code
  FROM mg_documents d
  LEFT JOIN users u ON u.id = d.imported_by
  LEFT JOIN mg_orders o ON o.document_id = d.id`;

function mapDocument(row: DocumentRow): MgDocumentDTO {
  return {
    id: row.id,
    code: row.code,
    fileName: row.file_name,
    sha256: row.sha256,
    sizeBytes: row.size_bytes,
    pageCount: row.page_count,
    status: row.status,
    externalOrderNo: row.external_order_no,
    importedByName: row.imported_by_name,
    importedAt: row.imported_at,
    notes: row.notes,
    extractedText: row.extracted_text,
    orderCode: row.order_code,
    orderId: row.order_id,
  };
}

export function listDocuments(actor: Actor): MgDocumentDTO[] {
  requireMagasinier(actor);
  const db = sessionsDb();
  return (
    db.prepare(`${DOCUMENT_SELECT} ORDER BY d.id DESC LIMIT 300`).all() as DocumentRow[]
  ).map(mapDocument);
}

export function getDocument(actor: Actor, documentId: number): MgDocumentDTO {
  requireMagasinier(actor);
  const db = sessionsDb();
  const row = db.prepare(`${DOCUMENT_SELECT} WHERE d.id = ?`).get(documentId) as
    | DocumentRow
    | undefined;
  if (!row) throw new ServiceError('Document introuvable.', 404);
  return mapDocument(row);
}

async function extractPdf(buffer: Buffer): Promise<{ text: string; pages: number }> {
  const { extractText, getDocumentProxy } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const result = await extractText(pdf, { mergePages: true });
  return { text: (result.text ?? '').trim(), pages: result.totalPages ?? 0 };
}

/** Import d'un PDF : empreinte, limites, extraction, commande liée. */
export async function importDocument(
  actor: Actor,
  file: { name: string; buffer: Buffer },
): Promise<MgExtractResultDTO> {
  requireMagasinier(actor);
  if (actor.id === null) throw new ServiceError('Session utilisateur invalide.', 401);
  const actorId = actor.id;
  const db = sessionsDb();
  const limits = pdfLimits(db);
  if (file.buffer.length === 0) {
    throw new ServiceError('Le fichier est vide.', 400);
  }
  if (file.buffer.length > limits.maxBytes) {
    throw new ServiceError(
      `Le fichier dépasse la taille maximale autorisée (${Math.round(limits.maxBytes / (1024 * 1024))} Mo).`,
      400,
    );
  }
  const header = file.buffer.subarray(0, 5).toString('latin1');
  if (header !== '%PDF-') {
    throw new ServiceError('Ce fichier n’est pas un PDF valide.', 400);
  }
  const sha256 = crypto.createHash('sha256').update(file.buffer).digest('hex');

  const duplicate = db
    .prepare('SELECT id, code FROM mg_documents WHERE sha256 = ?')
    .get(sha256) as { id: number; code: string } | undefined;
  if (duplicate) {
    throw new ServiceError(
      `Doublon : ce fichier a déjà été importé (document ${duplicate.code}).`,
      409,
    );
  }

  let text = '';
  let pages = 0;
  try {
    const extraction = await extractPdf(file.buffer);
    text = extraction.text;
    pages = extraction.pages;
  } catch (cause) {
    throw new ServiceError(
      `PDF illisible ou protégé : ${(cause as Error).message || 'extraction impossible'}.`,
      400,
    );
  }
  if (pages > limits.maxPages) {
    throw new ServiceError(
      `Le PDF dépasse le nombre de pages autorisé (${limits.maxPages}).`,
      400,
    );
  }

  const parsed = parseOrderText(text);
  const run = db.transaction((): MgExtractResultDTO => {
    const code = nextMgCode(db, 'mg_documents', 'DOC-');
    let status: MgDocumentDTO['status'];
    let message: string;
    let orderNoAlreadyKnown = false;
    if (text.length === 0) {
      status = 'ocr_indisponible';
      message =
        'PDF scanné : aucun texte extractible. Le moteur OCR n’est pas disponible, procédez à une saisie manuelle.';
    } else if (parsed.lines.length === 0) {
      status = 'extraction_partielle';
      message =
        'Texte extrait mais aucune ligne de commande reconnue. Vérifiez et saisissez les lignes manuellement.';
    } else {
      status = 'extraction_ok';
      message = `Extraction réussie : ${parsed.lines.length} ligne(s) reconnue(s).`;
    }
    if (parsed.orderNo) {
      const existingOrder = db
        .prepare('SELECT code FROM mg_orders WHERE external_order_no = ?')
        .get(parsed.orderNo) as { code: string } | undefined;
      if (existingOrder) {
        orderNoAlreadyKnown = true;
        status = 'a_verifier';
        message += ` Attention : la commande externe ${parsed.orderNo} existe déjà (${existingOrder.code}).`;
        raiseAlert(db, {
          category: 'DOUBLON_COMMANDE_MG',
          severity: 'warning',
          objectType: 'mg_document',
          objectId: 0,
          message: `Doublon potentiel : la commande externe ${parsed.orderNo} figure déjà dans ${existingOrder.code}.`,
          ownerRole: 'chef_magasinier',
        });
      }
    }
    const result = db
      .prepare(
        `INSERT INTO mg_documents
           (code, file_name, sha256, size_bytes, page_count, status,
            external_order_no, extracted_text, imported_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        code,
        file.name.slice(0, 200),
        sha256,
        file.buffer.length,
        pages,
        status,
        parsed.orderNo,
        text.slice(0, 20000),
        actorId,
      );
    const documentId = Number(result.lastInsertRowid);
    addMgHistory(db, {
      action: 'PDF_IMPORTE',
      entityType: 'mg_document',
      entityId: documentId,
      actorId,
      newValue: { code, fileName: file.name, pages, status },
    });
    if (parsed.lines.length > 0) {
      createOrderInternal(
        db,
        documentId,
        code,
        parsed,
        actorId,
        Boolean(parsed.orderNo) && !orderNoAlreadyKnown,
      );
    }
    return {
      documentId,
      code,
      status,
      orderNo: parsed.orderNo,
      orderDate: parsed.orderDate,
      clientName: parsed.clientName,
      lines: parsed.lines,
      message,
    };
  });
  return run();
}


/** Rejet d'un document erroné : motif obligatoire, historisé. */
export function rejectDocument(actor: Actor, input: Record<string, unknown>): void {
  requireMagasinier(actor);
  const db = sessionsDb();
  const documentId = Number(input.documentId);
  const reason = requireText(input.reason, 'Le motif du rejet', 300);
  const run = db.transaction((): void => {
    const doc = db
      .prepare('SELECT id, code, status FROM mg_documents WHERE id = ?')
      .get(documentId) as { id: number; code: string; status: string } | undefined;
    if (!doc) throw new ServiceError('Document introuvable.', 404);
    if (doc.status === 'valide') {
      throw new ServiceError('Un document validé ne peut pas être rejeté.', 409);
    }
    const linked = db
      .prepare('SELECT id, status FROM mg_orders WHERE document_id = ?')
      .get(documentId) as { id: number; status: string } | undefined;
    if (linked && linked.status !== 'a_verifier' && linked.status !== 'anomalie') {
      throw new ServiceError(
        'La commande liée a déjà progressé : annulez la commande plutôt que le document.',
        409,
      );
    }
    db.prepare(`UPDATE mg_documents SET status = 'rejete' WHERE id = ?`).run(documentId);
    if (linked) {
      db.prepare(`UPDATE mg_orders SET status = 'annule' WHERE id = ?`).run(linked.id);
    }
    addMgHistory(db, {
      action: 'PDF_REJETE',
      entityType: 'mg_document',
      entityId: documentId,
      actorId: actor.id ?? 0,
      oldValue: { status: doc.status },
      newValue: { status: 'rejete' },
      reason,
    });
  });
  run();
}

/** Saisie manuelle d'une commande (PDF scanné ou extraction partielle). */
export function createManualOrder(
  actor: Actor,
  input: Record<string, unknown>,
): MgDocumentDTO {
  requireMagasinier(actor);
  if (actor.id === null) throw new ServiceError('Session utilisateur invalide.', 401);
  const actorId = actor.id;
  const db = sessionsDb();
  const documentId = requireText(input.documentId, 'Le document', 20);
  const clientName = normalizeText(input.clientName, 120);
  const externalOrderNo = normalizeText(input.externalOrderNo, 60);
  const rawLines = Array.isArray(input.lines) ? input.lines : [];
  if (rawLines.length === 0) {
    throw new ServiceError('Au moins une ligne de commande est requise.', 400);
  }
  const run = db.transaction((): number => {
    const doc = db
      .prepare('SELECT id, code, status, external_order_no FROM mg_documents WHERE id = ?')
      .get(Number(documentId)) as
      | { id: number; code: string; status: string; external_order_no: string | null }
      | undefined;
    if (!doc) throw new ServiceError('Document introuvable.', 404);
    if (doc.status === 'valide' || doc.status === 'rejete') {
      throw new ServiceError(
        'Ce document a déjà été traité : la saisie manuelle n’est plus possible.',
        409,
      );
    }
    const existing = db
      .prepare('SELECT id FROM mg_orders WHERE document_id = ?')
      .get(doc.id) as { id: number } | undefined;
    if (existing) {
      throw new ServiceError('Une commande existe déjà pour ce document.', 409);
    }
    if (externalOrderNo) {
      const dup = db
        .prepare('SELECT id FROM mg_orders WHERE external_order_no = ?')
        .get(externalOrderNo) as { id: number } | undefined;
      if (dup) {
        throw new ServiceError(
          `La commande externe ${externalOrderNo} existe déjà.`,
          409,
        );
      }
    }
    const orderCode = nextMgCode(db, 'mg_orders', 'CMD-');
    const result = db
      .prepare(
        `INSERT INTO mg_orders
           (code, document_id, external_order_no, client_name, created_by)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(orderCode, doc.id, externalOrderNo ?? doc.external_order_no, clientName, actorId);
    const orderId = Number(result.lastInsertRowid);
    const insertLine = db.prepare(
      `INSERT INTO mg_order_lines
         (order_id, product_id, color_id, size_id, raw_text, qty_ordered, match_status)
       VALUES (?, ?, ?, ?, ?, ?, 'non_reconnu')`,
    );
    for (const raw of rawLines as Array<Record<string, unknown>>) {
      const qty = Number(String(raw.qty ?? '').replace(',', '.'));
      if (!Number.isFinite(qty) || qty <= 0) {
        throw new ServiceError('Chaque ligne exige une quantité positive.', 400);
      }
      insertLine.run(
        orderId,
        null,
        null,
        null,
        normalizeText(raw.rawText, 200),
        qty,
      );
    }
    db.prepare(
      `UPDATE mg_documents SET status = 'a_verifier',
         external_order_no = COALESCE(external_order_no, ?) WHERE id = ?`,
    ).run(externalOrderNo, doc.id);
    addMgHistory(db, {
      action: 'COMMANDE_SAISIE_MANUELLE',
      entityType: 'mg_order',
      entityId: orderId,
      actorId,
      newValue: { orderCode, lines: rawLines.length },
    });
    return orderId;
  });
  const orderId = run();
  const doc = db
    .prepare('SELECT document_id FROM mg_orders WHERE id = ?')
    .get(orderId) as { document_id: number };
  return getDocument(actor, doc.document_id);
}
