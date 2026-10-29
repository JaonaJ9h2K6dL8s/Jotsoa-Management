/* Audit E16 — scénario API complet sur le serveur isolé (port 3105).
 * Base : data/audit-e16.db (copie). Jamais le plan #20. */
const BASE = 'http://localhost:3105';
let cookie = '';

async function api(path, body) {
  const response = await fetch(BASE + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) }; }
  return { status: response.status, json };
}

function counters(dbPath) {
  const db = require('better-sqlite3')(dbPath, { readonly: true });
  const one = (sql) => db.prepare(sql).get().c;
  const result = {
    rollMovements: one('SELECT COUNT(*) c FROM coupe_roll_movements'),
    transfers: one('SELECT COUNT(*) c FROM coupe_transfers'),
    lots: one('SELECT COUNT(*) c FROM coupe_lots'),
    tickets: one('SELECT COUNT(*) c FROM production_tickets'),
  };
  db.close();
  return result;
}

function placementsOf(planJson) {
  return JSON.stringify(planJson.placements ?? JSON.parse(planJson.pieces_json ?? '[]'));
}

async function main() {
  const DB = './data/audit-e16.db';
  const before = counters(DB);
  console.log(' compteurs avant :', JSON.stringify(before));

  const login = await api('/api/auth/login', {
    username: 'chef.coupe', password: 'Audit-E16-test',
  });
  if (login.json.status !== 'ok') throw new Error('login échoué');
  console.log(' login chef.coupe : ok (rôle', login.json.user.roleCode + ')');

  const plan1 = await api('/api/cutting/atelier', { plan.get, planId: 1 });
  if (plan1.json.status !== 'ok') throw new Error('plan.get 1 : ' + JSON.stringify(plan1.json));
  const plan = plan1.json.item;
  const initialPlacements = placementsOf(plan);
  console.log(' plan #1 :', plan.status, '| pièces placées :',
    JSON.parse(plan.pieces_json).length, '| révision :', plan.revision_id);

  const optimize = await api('/api/cutting/atelier', { plan.optimize, planId: 1 });
  if (optimize.json.status !== 'ok') throw new Error('plan.optimize : ' + JSON.stringify(optimize.json));
  const proposal = optimize.json.result;
  console.log(' optimize :', proposal.method,
    '| candidates :', JSON.stringify(proposal.candidates ?? []),
    '| placées :', proposal.placements.length,
    '| non placées :', proposal.unplaced.length,
    '| longueur :', proposal.metrics.consumedLengthCm, 'cm',
    '| taux :', proposal.metrics.utilizationPct + '%',
    '| budget dépassé :', proposal.budgetExpired === true);

  const afterOptimize = await api('/api/cutting/atelier', { plan.get, planId: 1 });
  const unchanged = placementsOf(afterOptimize.json.item) === initialPlacements;
  console.log(' annulation (aucun enregistrement) : plan #1 inchangé =>', unchanged);

  // Modification concurrente : on enregistre un placement déplacé.
  const current = JSON.parse(afterOptimize.json.item.pieces_json);
  const moved = current.map((placement, index) => index === 0
    ? { ...placement, x: (placement.x ?? 0) + 3, y: (placement.y ?? 0) + 2,
        points: placement.points.map((point) => ({ x: point.x + 3, y: point.y + 2 })) }
    : placement);
  const concurrentSave = await api('/api/cutting/atelier', {
    plan.save, planId: 1, placements: moved,
  });
  console.log(' sauvegarde concurrente (pièce déplacée) :',
    concurrentSave.json.status === 'ok' ? 'ok' : JSON.stringify(concurrentSave.json).slice(0, 200));

  // Proposition obsolète (celle calculée AVANT la modification) rejouée.
  const staleSave = await api('/api/cutting/atelier', {
    plan.save, planId: 1, placements: proposal.placements,
  });
  const staleAccepted = staleSave.json.status === 'ok';
  console.log(' acceptation de la proposition obsolète :',
    staleAccepted ? 'ACCEPTEE (écrase la modification concurrente)'
      : 'REJETEE (' + JSON.stringify(staleSave.json).slice(0, 200) + ')');

  const finalPlan = await api('/api/cutting/atelier', { plan.get, planId: 1 });
  const finalPlacements = placementsOf(finalPlan.json.item);
  console.log(' état final du plan #1 :',
    finalPlacements === placementsOf(proposal) ? '= proposition obsolète'
      : finalPlacements === JSON.stringify(moved) ? '= modification concurrente'
        : 'autre');

  const after = counters(DB);
  console.log(' compteurs après :', JSON.stringify(after));
  console.log(' aucune consommation/transfert :',
    JSON.stringify(before) === JSON.stringify(after) ? 'ok' : 'CHANGEMENT DETECTE');
}

main().catch((error) => { console.error('ECHEC AUDIT :', error.message); process.exit(1); });
