/**
 * Validation E17.1 : parcours réel via HTTP sur le serveur de test
 * isolé (port 3101, base data/e17-browser.db). Rejoue exactement le
 * flux utilisateur : connexion chef de coupe → transfert depuis les
 * placements → ticket imprimable (lecture seule) → connexion chef de
 * couture → réception partielle puis complète → refus non autorisé →
 * double soumission refusée. Le plan historique #20 n'existe pas dans
 * cette base isolée.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const BASE = 'http://127.0.0.1:3101';
const PASSWORD = 'E17-Test-2026';
const db = require('better-sqlite3')(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/e17-browser.db'),
);

const failures = [];
const results = [];
function record(label, ok, detail = '') {
  results.push(`${ok ? 'RÉUSSI' : 'ÉCHOUÉ'} — ${label}${detail ? ` : ${detail}` : ''}`);
  if (!ok) failures.push(label);
}

async function login(username) {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE },
    body: JSON.stringify({ username, password: PASSWORD }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`Connexion ${username} : ${body.message}`);
  return response.headers.get('set-cookie').split(';')[0];
}

async function atelier(cookie, action, input) {
  const response = await fetch(`${BASE}/api/cutting/atelier`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE, Cookie: cookie },
    body: JSON.stringify({ action, input }),
  });
  return { status: response.status, body: await response.json() };
}

async function coutureApi(cookie, path, init) {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Origin: BASE, Cookie: cookie, ...(init?.headers ?? {}) },
  });
  let body = null;
  try { body = await response.json(); } catch { /* page HTML */ }
  return { status: response.status, body };
}

function counters() {
  const one = (sql) => db.prepare(sql).get().n;
  return {
    transfers: one('SELECT COUNT(*) AS n FROM coupe_transfers'),
    receptions: one('SELECT COUNT(*) AS n FROM couture_receptions'),
    tickets: one('SELECT COUNT(*) AS n FROM production_tickets'),
    movements: one('SELECT COUNT(*) AS n FROM coupe_roll_movements'),
    roll: db.prepare('SELECT remaining_weight_kg FROM coupe_rolls LIMIT 1').get().remaining_weight_kg,
  };
}

// ── 1-4. Chef de coupe : transfert du plan #1 ──────────────────────
const chef = await login('chef.coupe');
record('1. Connexion chef.coupe (base isolée)', true);

const plan1 = await atelier(chef, 'plan.get', { planId: 1 });
record('2-3. Ouverture du plan #1', plan1.status === 200
  && plan1.body.item.status === 'valide',
`statut=${plan1.body.item?.status}, pièces=${plan1.body.item?.placements?.length}`);

const placedCounts = new Map();
for (const placement of plan1.body.item.placements) {
  placedCounts.set(placement.pieceId, (placedCounts.get(placement.pieceId) ?? 0) + 1);
}
const cutPieces = [...placedCounts.entries()].map(([pieceId, qty]) => ({ pieceId, qty }));

const beforeTransfer = counters();
const transfer = await atelier(chef, 'transfer.create', {
  planId: 1, cutPieces, confirmCut: true, notes: 'Validation navigateur E17.1',
});
const ticketNo = transfer.body.item?.ticketNo;
record('4. Transfert du plan #1 selon le processus existant',
  transfer.status === 200 && Boolean(ticketNo),
  `ticket=${ticketNo}, lot=${transfer.body.item?.lotCode}, qté=${transfer.body.item?.transferredQty}`);

// ── 5-7. Ticket imprimable : contenu et lecture seule ──────────────
const page = await fetch(`${BASE}/coupe/transferts/${transfer.body.item.transferId}`, {
  headers: { Cookie: chef },
});
const html = await page.text();
const checks = [
  ['numéro du ticket affiché', html.includes(ticketNo)],
  ['titre bon de transfert', html.includes('BON DE TRANSFERT — COUPE VERS COUTURE')],
  ['émetteur (nom)', html.includes('Rakoto')],
  ['fonction émetteur', html.includes('Chef de coupe')],
  ['lot', html.includes(transfer.body.item.lotCode)],
  ['plan associé', html.includes('#1')],
  ['lignes de pièces', html.includes('devant') && html.includes('manche')],
  ['en attente de réception', html.includes('EN ATTENTE DE RÉCEPTION')],
  ['mise en page A4 (@page)', html.includes('size: A4')],
  ['CSS impression sans boutons', html.includes('ticket-print-hide')],
];
for (const [label, ok] of checks) record(`5-7. Ticket : ${label}`, ok);

const afterPage1 = counters();
await fetch(`${BASE}/coupe/transferts/${transfer.body.item.transferId}`, { headers: { Cookie: chef } });
const afterPage2 = counters();
record('9. Consultation/impression = aucun effet de bord',
  JSON.stringify(afterPage1) === JSON.stringify(afterPage2),
  JSON.stringify(afterPage2));

const transfer2 = await atelier(chef, 'transfer.create', {
  planId: 2, cutPieces: await (async () => {
    const plan2 = await atelier(chef, 'plan.get', { planId: 2 });
    const counts = new Map();
    for (const placement of plan2.body.item.placements) {
      counts.set(placement.pieceId, (counts.get(placement.pieceId) ?? 0) + 1);
    }
    return [...counts.entries()].map(([pieceId, qty]) => ({ pieceId, qty }));
  })(),
  confirmCut: true,
});
record('15a. Second transfert (plan #2) avec numéro séquentiel',
  transfer2.status === 200 && transfer2.body.item.ticketNo !== ticketNo,
  `ticket=${transfer2.body.item?.ticketNo}`);

// ── 10-14. Chef de couture : réceptions ────────────────────────────
const couture = await login('chef.couture');
record('10. Connexion chef.couture', true);
const pending = await coutureApi(couture, '/api/couture/receptions');
const pendingA = pending.body.items.pending.find(
  (item) => item.transferId === transfer.body.item.transferId,
);
record('11. Ticket retrouvé dans les réceptions en attente',
  Boolean(pendingA) && pendingA.ticketNo === ticketNo,
  `ticket=${pendingA?.ticketNo ?? 'absent'}`);

const sizeId = pendingA.lines[0].sizeId;
const reception = await coutureApi(couture, '/api/couture/receptions', {
  method: 'POST',
  body: JSON.stringify({
    transferId: transfer.body.item.transferId,
    notes: 'Un carton ouvert, écart constaté.',
    lines: [{ sizeId, receivedQty: 1 }],
  }),
});
record('12. Réception partielle confirmée',
  reception.status === 201 && reception.body.item?.status === 'partielle',
  `statut=${reception.body?.item?.status ?? reception.body?.status}`);

const ticketAfter = await fetch(`${BASE}/coupe/transferts/${transfer.body.item.transferId}`, {
  headers: { Cookie: couture },
});
const htmlAfter = await ticketAfter.text();
record('13-14. Ticket après réception : statut, écart, réceptionnaire, date',
  htmlAfter.includes('Réception partielle')
  && htmlAfter.includes('Écart : 1 manquante(s)')
  && htmlAfter.includes('Ravao Miora')
  && htmlAfter.includes('Reçu le'),
  'page ticket re-vérifiée après réception');

// 15. Réception complète sur le second transfert.
const pending2 = await coutureApi(couture, '/api/couture/receptions');
const pendingB = pending2.body.items.pending.find(
  (item) => item.transferId === transfer2.body.item.transferId,
);
const full = pendingB.lines[0].qty;
const complete = await coutureApi(couture, '/api/couture/receptions', {
  method: 'POST',
  body: JSON.stringify({
    transferId: transfer2.body.item.transferId,
    lines: [{ sizeId: pendingB.lines[0].sizeId, receivedQty: full }],
  }),
});
record('15b. Réception complète (plan #2)',
  complete.status === 201 && complete.body.item?.status === 'complete',
  `statut=${complete.body?.item?.status ?? complete.body?.status}`);

// ── 16. Permissions : utilisateur non autorisé ─────────────────────
const stock = await login('chef.stock');
const pageStock = await fetch(`${BASE}/coupe/transferts/${transfer.body.item.transferId}`, {
  headers: { Cookie: stock }, redirect: 'manual',
});
record('16a. Non-autorisé : page ticket inaccessible',
  pageStock.status >= 300 && pageStock.status < 400, `http=${pageStock.status}`);
const deniedReception = await coutureApi(stock, '/api/couture/receptions', {
  method: 'POST',
  body: JSON.stringify({ transferId: transfer2.body.item.transferId, lines: [] }),
});
record('16b. Non-autorisé : réception refusée (403)', deniedReception.status === 403,
  `http=${deniedReception.status}`);
const deniedTransfer = await atelier(stock, 'transfer.create', {
  planId: 1, cutPieces: [], confirmCut: true,
});
record('16c. Non-autorisé : transfert refusé (403)', deniedTransfer.status === 403,
  `http=${deniedTransfer.status}`);

// ── 17. Double soumission ──────────────────────────────────────────
const beforeDouble = counters();
const double1 = await coutureApi(couture, '/api/couture/receptions', {
  method: 'POST',
  body: JSON.stringify({
    transferId: transfer.body.item.transferId,
    lines: [{ sizeId, receivedQty: 2 }],
  }),
});
const double2 = await coutureApi(couture, '/api/couture/receptions', {
  method: 'POST',
  body: JSON.stringify({
    transferId: transfer.body.item.transferId,
    lines: [{ sizeId, receivedQty: 2 }],
  }),
});
const afterDouble = counters();
record('17. Double réception refusée, aucun effet supplémentaire',
  double1.status === 409 && double2.status === 409
  && JSON.stringify(beforeDouble) === JSON.stringify(afterDouble),
  `http=${double1.status}/${double2.status}`);

const finalTicket = await atelier(chef, 'transfer.create', {
  planId: 1, cutPieces, confirmCut: true,
});
record('17b. Double transfert du même plan refusé', finalTicket.status === 409,
  `http=${finalTicket.status}`);

console.log('\n=== RÉSULTATS E17.1 (HTTP réel, base isolée) ===');
for (const line of results) console.log(`  ${line}`);
console.log(`\n${results.length - failures.length}/${results.length} contrôles réussis`);
db.close();
if (failures.length > 0) process.exit(1);
