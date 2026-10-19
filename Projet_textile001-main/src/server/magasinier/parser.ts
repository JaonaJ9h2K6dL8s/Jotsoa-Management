import type Database from 'better-sqlite3';
import type { MgExtractedLineDTO } from '@/types/magasinier';

/**
 * Extraction honnête du contenu d'un PDF de commande : seuls les
 * champs réellement détectés sont renseignés, tout le reste reste
 * vide. Aucune donnée n'est inventée ; les lignes non reconnues sont
 * conservées pour correction manuelle.
 */

const ORDER_NO_PATTERNS = [
  // « n » peut être suivi du signe degré (parfois perdu par l'encodage
  // PDF WinAnsi) : les variantes n°, n, n°, numero sont tolérées.
  /commande\s*(?:n[°oº]?|num(?:ero|éro)?)?\s*[:.]?\s*([A-Za-z0-9][A-Za-z0-9/_-]{2,})/i,
  /order\s*(?:no|number|#)?\s*[:.]?\s*([A-Za-z0-9][A-Za-z0-9/_-]{2,})/i,
];

const DATE_PATTERN =
  /(\d{4}-\d{2}-\d{2})|(\d{2}\/\d{2}\/\d{4})/;

const CLIENT_PATTERN = /client(?:\s*|\s*nom)?\s*[:\-]\s*(.+)/i;

/** Produit / Couleur / Taille / Quantité (ou ; | , en séparateurs). */
const LINE_PATTERN =
  /^(.+?)\s*[/;|]\s*(.+?)\s*[/;|]\s*(.+?)\s*[/;|]\s*(\d+(?:[.,]\d+)?)$/;

export interface ParsedOrder {
  orderNo: string | null;
  orderDate: string | null;
  clientName: string | null;
  lines: MgExtractedLineDTO[];
  unparsedLines: string[];
}

export function parseOrderText(text: string): ParsedOrder {
  const normalized = text.replace(/\r\n?/g, '\n').trim();
  const lines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  let orderNo: string | null = null;
  for (const pattern of ORDER_NO_PATTERNS) {
    const match = normalized.match(pattern);
    if (match?.[1]) {
      orderNo = match[1].trim();
      break;
    }
  }

  const dateMatch = normalized.match(DATE_PATTERN);
  const orderDate = dateMatch ? dateMatch[0] : null;

  const clientMatch = normalized.match(CLIENT_PATTERN);
  const clientName = clientMatch?.[1] ? clientMatch[1].trim().slice(0, 120) : null;

  const extracted: MgExtractedLineDTO[] = [];
  const unparsed: string[] = [];
  for (const line of lines) {
    const lineMatch = line.match(LINE_PATTERN);
    const qty = lineMatch ? Number(lineMatch[4].replace(',', '.')) : null;
    if (lineMatch && qty !== null && Number.isFinite(qty) && qty > 0) {
      extracted.push({
        rawText: line,
        productNom: lineMatch[1].trim().slice(0, 120),
        colorNom: lineMatch[2].trim().slice(0, 80),
        sizeNom: lineMatch[3].trim().slice(0, 20),
        qty,
      });
    } else if (!/^(commande|order|client|date)\b/i.test(line)) {
      unparsed.push(line.slice(0, 200));
    }
  }

  return { orderNo, orderDate, clientName, lines: extracted, unparsedLines: unparsed };
}

/** Normalisation souple pour la correspondance au catalogue. */
export function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export interface CatalogueMatch {
  productId: number | null;
  colorId: number | null;
  sizeId: number | null;
}

/**
 * Associe une ligne extraite au catalogue interne. Le nom commercial
 * seul ne suffit pas : une correspondance ambiguë (plusieurs produits)
 * reste non reconnue et exigera une association manuelle.
 */
export function matchLine(
  db: Database.Database,
  line: MgExtractedLineDTO,
): CatalogueMatch {
  const match: CatalogueMatch = { productId: null, colorId: null, sizeId: null };
  if (line.productNom) {
    const exact = db
      .prepare(
        `SELECT id FROM products WHERE is_active = 1 AND LOWER(nom) = LOWER(?)`,
      )
      .all(line.productNom) as Array<{ id: number }>;
    if (exact.length === 1) {
      match.productId = exact[0].id;
    } else if (exact.length === 0) {
      const contains = db
        .prepare(
          `SELECT id FROM products
           WHERE is_active = 1 AND LOWER(nom) LIKE LOWER('%' || ? || '%')`,
        )
        .all(line.productNom) as Array<{ id: number }>;
      if (contains.length === 1) match.productId = contains[0].id;
    }
  }
  if (line.colorNom) {
    const exact = db
      .prepare(`SELECT id FROM colors WHERE is_active = 1 AND LOWER(nom) = LOWER(?)`)
      .all(line.colorNom) as Array<{ id: number }>;
    if (exact.length === 1) match.colorId = exact[0].id;
  }
  if (line.sizeNom) {
    const exact = db
      .prepare(`SELECT id FROM sizes WHERE is_active = 1 AND LOWER(nom) = LOWER(?)`)
      .all(line.sizeNom) as Array<{ id: number }>;
    if (exact.length === 1) match.sizeId = exact[0].id;
  }
  return match;
}
