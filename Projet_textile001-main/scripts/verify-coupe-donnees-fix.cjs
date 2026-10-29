/**
 * Rattrapage vérification étape 12 : désactive le produit de test créé
 * avec la catégorie par défaut (adulte) et crée le produit enfant
 * attendu (le script de vérification n'avait pas sélectionné la
 * catégorie). Suppression impossible : produit → désactivé.
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const PORT = 9234;
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

async function main() {
  const profile = path.join(OUT, 'edge-profile');
  const edge = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`, '--window-size=1600,900',
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
      if (result.exceptionDetails) {
        throw new Error(`evaluate: ${result.exceptionDetails.text}`);
      }
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
      name: nameValue.slice(0, eq),
      value: nameValue.slice(eq + 1),
      url: 'http://localhost:3000',
      path: '/',
    });
    await send('Page.navigate', { url: 'http://localhost:3000/coupe/donnees' });
    await sleep(4000);

    // 1. Désactivation du produit adulte créé par erreur.
    const deactivated = await evaluate(`
      (async () => {
        const row = [...document.querySelectorAll('table')]
          .map(t => [...t.querySelectorAll('tbody tr')]).flat()
          .find(tr => tr.textContent.includes('Débardeur Vérif E12'));
        if (!row) return 'introuvable';
        [...row.querySelectorAll('button')].find(b => b.textContent === 'Modifier').click();
        await new Promise(r => setTimeout(r, 500));
        const active = [...document.querySelectorAll('.MuiDialog-container input[type="checkbox"]')]
          .find(c => c.checked);
        if (active) active.click();
        await new Promise(r => setTimeout(r, 200));
        [...document.querySelectorAll('button')]
          .find(b => b.textContent.trim() === 'Enregistrer').click();
        await new Promise(r => setTimeout(r, 2000));
        const row2 = [...document.querySelectorAll('table')]
          .map(t => [...t.querySelectorAll('tbody tr')]).flat()
          .find(tr => tr.textContent.includes('Débardeur Vérif E12'));
        return row2?.textContent ?? '';
      })()
    `);
    console.log('produit adulte:', JSON.stringify(deactivated));
    if (!String(deactivated).includes('inactif')) throw new Error('désactivation ratée');

    // 2. Création du produit enfant (famille tshirt, catégorie enfant, 2 ans).
    const created = await evaluate(`
      (async () => {
        [...document.querySelectorAll('button')]
          .find(b => b.textContent.trim() === 'Nouveau produit').click();
        await new Promise(r => setTimeout(r, 500));
        const input = document.querySelector('.MuiDialog-container input');
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, 'Débardeur Enfant E12');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        const combo = [...document.querySelectorAll('.MuiDialog-container [role="combobox"]')][1];
        combo.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        combo.click();
        await new Promise(r => setTimeout(r, 400));
        const enfant = [...document.querySelectorAll('li[role="option"]')]
          .find(o => o.textContent.trim().endsWith('Enfant'));
        enfant.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        enfant.click();
        await new Promise(r => setTimeout(r, 300));
        const sizes = [...document.querySelectorAll('.MuiDialog-container [role="combobox"]')][2];
        sizes.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        sizes.click();
        await new Promise(r => setTimeout(r, 400));
        const twoYears = [...document.querySelectorAll('li[role="option"]')]
          .find(o => o.textContent.includes('2 ans'));
        twoYears.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        twoYears.click();
        await new Promise(r => setTimeout(r, 200));
        [...document.querySelectorAll('button')]
          .find(b => b.textContent.trim() === 'Enregistrer').click();
        await new Promise(r => setTimeout(r, 2000));
        const row = [...document.querySelectorAll('table')]
          .map(t => [...t.querySelectorAll('tbody tr')]).flat()
          .find(tr => tr.textContent.includes('Débardeur Enfant E12'));
        return row?.textContent ?? '';
      })()
    `);
    console.log('produit enfant:', JSON.stringify(created));
    const ok = String(created).includes('enfant') && String(created).includes('2 ans')
      && String(created).includes('actif');
    await screenshot('16-produit-enfant-cree.png');
    console.log(ok
      ? 'RATTRAPAGE TERMINÉ — produit enfant créé correctement'
      : 'RATTRAPAGE ÉCHOUÉ');
    process.exitCode = ok ? 0 : 1;
    ws.close();
  } finally {
    edge.kill();
  }
}

main().catch((error) => {
  console.error('ÉCHEC:', error.message);
  process.exit(1);
});
