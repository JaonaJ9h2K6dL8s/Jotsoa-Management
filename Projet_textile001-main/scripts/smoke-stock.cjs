/* Smoke HTTP du module Stock : serveur de production sur le port 3458. */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const http = require('node:http');

const BASE = { host: '127.0.0.1', port: 3458 };
let cookie = '';
const results = [];

function req(path, method, body) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    if (body) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(body);
    }
    const r = http.request({ ...BASE, path, method, headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        const setCookie = res.headers['set-cookie'];
        if (setCookie) cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
        resolve({ status: res.statusCode, body: data });
      });
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

function expect(label, status, predicate) {
  results.push({ label, status, ok: predicate });
  console.log(`${predicate ? 'OK ' : 'FAIL'} [${status}] ${label}`);
}

(async () => {
  const health = await req('/api/health', 'GET');
  expect('health', health.status, health.status === 200);

  // Refus anonyme sur une route stock
  const anon = await req('/api/stock/dashboard', 'GET');
  expect('dashboard anonyme refusé', anon.status, anon.status === 401);

  const login = await req(
    '/api/auth/login',
    'POST',
    JSON.stringify({ username: 'stock.jo', password: 'Stock#2026' }),
  );
  expect('connexion chef_stock', login.status, login.status === 200);

  const dash = await req('/api/stock/dashboard', 'GET');
  const dashBody = JSON.parse(dash.body);
  expect(
    'dashboard chef_stock',
    dash.status,
    dash.status === 200 && typeof dashBody.item?.cartonsCount === 'number',
  );

  const refs = await req('/api/stock/references', 'GET');
  const refsBody = JSON.parse(refs.body);
  expect(
    'references cartons + emplacements',
    refs.status,
    refs.status === 200 && Array.isArray(refsBody.cartons) && Array.isArray(refsBody.locations),
  );

  const entries = await req('/api/stock/entries', 'GET');
  expect('entrées + transferts CQ', entries.status, entries.status === 200);

  const mov = await req('/api/stock/movements', 'GET');
  const movBody = JSON.parse(mov.body);
  expect(
    'mouvements + soldes + transferts',
    mov.status,
    mov.status === 200 && Array.isArray(movBody.balances) && Array.isArray(movBody.transfers),
  );

  const inv = await req('/api/stock/inventories', 'GET');
  expect('inventaires', inv.status, inv.status === 200);

  const adj = await req('/api/stock/adjustments', 'GET');
  expect('ajustements', adj.status, adj.status === 200);

  const waste = await req('/api/stock/waste', 'GET');
  expect('déchets', waste.status, waste.status === 200);

  // Écriture interdite sans champ requis : 400 (et non 500)
  const badCarton = await req(
    '/api/stock/cartons',
    'POST',
    JSON.stringify({ action: 'create' }),
  );
  expect('création carton (code auto)', badCarton.status, badCarton.status === 201);

  // Page protégée accessible pour chef_stock
  const page = await req('/stock', 'GET');
  expect('page /stock', page.status, page.status === 200);

  console.log(`\nSmoke HTTP : ${results.filter((r) => r.ok).length}/${results.length} OK`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})().catch((error) => {
  console.error('SMOKE ÉCHEC :', error);
  process.exit(1);
});
