/**
 * Vérification navigateur (Edge headless + CDP) — patrons R2
 * réalistes : export des SVG de prévisualisation des révisions
 * générées + capture de l'atelier avec les pièces réelles.
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const PORT = 9236;
const OUT = path.join(__dirname, '..', 'verification-capture');
fs.mkdirSync(OUT, { recursive: true });

const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => fs.existsSync(p));
if (!EDGE) throw new Error('Edge introuvable');

function getJson(url, method = 'GET') {
  return new Promise((resolve, reject) => {
    const request = http.request(url, { method }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (error) { reject(error); }
      });
    });
    request.on('error', reject);
    request.end();
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const REVISIONS = [
  [7, 'tshirt-adulte-M'], [8, 'tshirt-enfant-6ans'], [9, 'polo-adulte-M'],
  [10, 'short-adulte-M'], [11, 'short-enfant-6ans'], [12, 'jogging-adulte-M'],
  [13, 'jogging-enfant-6ans'], [14, 'ensemble-enfant-6ans'],
];

async function main() {
  const profile = path.join(OUT, 'edge-profile');
  const edge = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`, '--window-size=1600,1000',
    '--no-first-run', 'about:blank',
  ], { stdio: 'ignore' });
  try {
    let version = null;
    for (let i = 0; i < 40 && !version; i += 1) {
      await sleep(500);
      try { version = await getJson(`http://127.0.0.1:${PORT}/json/version`); } catch { /* retry */ }
    }
    if (!version) throw new Error('CDP indisponible');
    await getJson(`http://127.0.0.1:${PORT}/json/new?about:blank`, 'PUT');
    let targets = null;
    for (let i = 0; i < 20 && !targets; i += 1) {
      await sleep(500);
      const list = await getJson(`http://127.0.0.1:${PORT}/json/list`);
      targets = list.find((item) => item.type === 'page' && item.webSocketDebuggerUrl) ?? null;
    }
    if (!targets) throw new Error('aucun onglet CDP');
    const ws = new WebSocket(targets.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    let nextId = 1;
    const pending = new Map();
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        const { resolve, reject } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) reject(new Error(`${message.error.message}`));
        else resolve(message.result);
      }
    };
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = nextId;
      nextId += 1;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async (expression) => {
      const result = await send('Runtime.evaluate', {
        expression, returnByValue: true, awaitPromise: true,
      });
      if (result.exceptionDetails) throw new Error(`evaluate: ${result.exceptionDetails.text}`);
      return result.result.value;
    };
    const screenshot = async (name) => {
      const result = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(OUT, name), Buffer.from(result.data, 'base64'));
      console.log(`capture: ${name}`);
    };

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.enable');
    const loginResponse = await fetch('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'chef.coupe', password: 'Coupe-2026!' }),
    });
    if (!loginResponse.ok) throw new Error(`login API: ${loginResponse.status}`);
    const rawCookie = loginResponse.headers.getSetCookie()
      .find((cookie) => !cookie.startsWith('Path=')) ?? '';
    const [nameValue] = rawCookie.split(';');
    const eq = nameValue.indexOf('=');
    await send('Network.setCookie', {
      name: nameValue.slice(0, eq), value: nameValue.slice(eq + 1),
      url: 'http://localhost:3000', path: '/',
    });
    await send('Page.navigate', { url: 'http://localhost:3000/coupe' });
    await sleep(4000);

    // Export des SVG de prévisualisation (une pièce = un contour réel).
    for (const [revisionId, slug] of REVISIONS) {
      const preview = await evaluate(`
        (async () => {
          const response = await fetch('/api/cutting/atelier', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'pattern.preview', input: { revisionId: ${revisionId} } }),
          });
          return response.json();
        })()
      `);
      if (!preview || preview.status !== 'ok') {
        console.log(`✘ preview révision #${revisionId}`);
        continue;
      }
      fs.writeFileSync(
        path.join(OUT, `patron-r2-${slug}.svg`),
        preview.result.svg, 'utf8',
      );
      console.log(`✔ patron-r2-${slug}.svg (${preview.result.pieceCount} pièces)`);
    }

    // Capture de l'atelier avec la révision t-shirt adulte M.
    await evaluate(`
      (async () => {
        const combo = document.querySelectorAll('[role="combobox"]')[2];
        if (!combo) return 'no-combo';
        combo.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        combo.click();
        await new Promise(r => setTimeout(r, 600));
        const option = [...document.querySelectorAll('li[role="option"]')]
          .find(o => o.textContent.includes('#7')) ?? null;
        if (!option) return [...document.querySelectorAll('li[role="option"]')]
          .map(o => o.textContent).join('|');
        option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        option.click();
        return 'ok';
      })()
    `);
    await sleep(2500);
    await screenshot('21-atelier-patrons-r2.png');

    ws.close();
    console.log('VERIFICATION TERMINÉE');
  } finally {
    edge.kill();
  }
}

main().catch((error) => {
  console.error('ÉCHEC:', error.message);
  process.exit(1);
});
