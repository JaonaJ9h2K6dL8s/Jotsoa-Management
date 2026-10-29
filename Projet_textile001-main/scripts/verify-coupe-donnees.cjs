/**
 * Vérification navigateur (Edge headless + CDP) de l'étape 12 :
 * page « Rouleaux & Produits » (/coupe/donnees) — création et
 * modification d'un rouleau, création d'un produit — et image de
 * patron générée automatiquement dans l'atelier (/coupe).
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const PORT = 9233;
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

  const failures = [];
  const expect = (label, ok, detail = '') => {
    console.log(`${ok ? '✔' : '✘'} ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures.push(label);
  };

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
    console.log('cookie de session injecté');

    // ── 1. Page Données : rouleaux ──────────────────────────────────
    await send('Page.navigate', { url: 'http://localhost:3000/coupe/donnees' });
    await sleep(4000);
    expect('navigation /coupe/donnees', await evaluate('location.pathname') === '/coupe/donnees');
    const pageState = await evaluate(`({
      heading: [...document.querySelectorAll('h5')].map(e => e.textContent).join('|'),
      rolls: [...document.querySelectorAll('table')][0]
        ? [...document.querySelectorAll('table')[0].querySelectorAll('tbody tr')].length : -1,
      hasNewRoll: [...document.querySelectorAll('button')]
        .some(b => b.textContent.trim() === 'Nouveau rouleau'),
    })`);
    console.log('état page:', JSON.stringify(pageState));
    expect('titre page + bouton Nouveau rouleau',
      pageState.heading.includes('Données de l’atelier Coupe') && pageState.hasNewRoll);
    expect('table rouleaux peuplée', pageState.rolls > 0, `${pageState.rolls} lignes`);
    await screenshot('12-donnees-rouleaux.png');

    // Création d'un rouleau via le dialog.
    await evaluate(`
      (async () => {
        [...document.querySelectorAll('button')]
          .find(b => b.textContent.trim() === 'Nouveau rouleau').click();
        await new Promise(r => setTimeout(r, 500));
        const inputs = [...document.querySelectorAll('.MuiDialog-container input')];
        const set = (el, value) => {
          const setter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, 'value').set;
          setter.call(el, value);
          el.dispatchEvent(new Event('input', { bubbles: true }));
        };
        set(inputs[0], 'R-VERIF-E12');
        set(inputs[1], '15');
        set(inputs[2], 'JERSEY-VERIF');
        set(inputs[4], '42');
        set(inputs[5], '180');
        set(inputs[6], '170');
        set(inputs[7], '200');
        return inputs.length;
      })()
    `);
    await sleep(300);
    await screenshot('13-dialog-rouleau.png');
    const rollCreated = await evaluate(`
      (async () => {
        [...document.querySelectorAll('button')]
          .find(b => b.textContent.trim() === 'Enregistrer').click();
        await new Promise(r => setTimeout(r, 2000));
        const toast = document.querySelector('.MuiSnackbar-root')?.textContent ?? '';
        const row = [...document.querySelectorAll('table')[0].querySelectorAll('tbody tr')]
          .find(tr => tr.textContent.includes('R-VERIF-E12'));
        return { toast, found: !!row, row: row?.textContent ?? '' };
      })()
    `);
    console.log('création rouleau:', JSON.stringify(rollCreated));
    expect('rouleau R-VERIF-E12 créé et listé', rollCreated.found, rollCreated.toast);

    // Modification du rouleau créé.
    const rollEdited = await evaluate(`
      (async () => {
        const row = [...document.querySelectorAll('table')[0].querySelectorAll('tbody tr')]
          .find(tr => tr.textContent.includes('R-VERIF-E12'));
        [...row.querySelectorAll('button')].find(b => b.textContent === 'Modifier').click();
        await new Promise(r => setTimeout(r, 500));
        const inputs = [...document.querySelectorAll('.MuiDialog-container input')];
        const codeLocked = inputs[0].disabled;
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype, 'value').set;
        setter.call(inputs[4], '55');
        inputs[4].dispatchEvent(new Event('input', { bubbles: true }));
        [...document.querySelectorAll('button')]
          .find(b => b.textContent.trim() === 'Enregistrer').click();
        await new Promise(r => setTimeout(r, 2000));
        const row2 = [...document.querySelectorAll('table')[0].querySelectorAll('tbody tr')]
          .find(tr => tr.textContent.includes('R-VERIF-E12'));
        return { codeLocked, updated: row2?.textContent.includes('55') ?? false };
      })()
    `);
    console.log('modification rouleau:', JSON.stringify(rollEdited));
    expect('code rouleau verrouillé en édition', rollEdited.codeLocked === true);
    expect('longueur rouleau mise à jour (42 → 55)', rollEdited.updated === true);

    // ── 2. Produits ─────────────────────────────────────────────────
    const prodState = await evaluate(`({
      header: [...document.querySelectorAll('h6')].map(e => e.textContent).join('|'),
      hasNewProduct: [...document.querySelectorAll('button')]
        .some(b => b.textContent.trim() === 'Nouveau produit'),
    })`);
    expect('section Produits + bouton Nouveau produit',
      prodState.header.includes('Produits') && prodState.hasNewProduct, prodState.header);

    await evaluate(`
      (async () => {
        [...document.querySelectorAll('button')]
          .find(b => b.textContent.trim() === 'Nouveau produit').click();
        await new Promise(r => setTimeout(r, 500));
        const input = document.querySelector('.MuiDialog-container input');
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, 'Débardeur Vérif E12');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        const combo = [...document.querySelectorAll('.MuiDialog-container [role="combobox"]')][2];
        combo.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        combo.click();
        await new Promise(r => setTimeout(r, 500));
        const option = [...document.querySelectorAll('li[role="option"]')]
          .find(o => o.textContent.includes('2 ans'));
        option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        option.click();
        return 'ok';
      })()
    `);
    await sleep(400);
    await screenshot('14-dialog-produit.png');
    const prodCreated = await evaluate(`
      (async () => {
        [...document.querySelectorAll('button')]
          .find(b => b.textContent.trim() === 'Enregistrer').click();
        await new Promise(r => setTimeout(r, 2000));
        const row = [...document.querySelectorAll('table')]
          .map(t => [...t.querySelectorAll('tbody tr')]).flat()
          .find(tr => tr.textContent.includes('Débardeur Vérif E12'));
        return { found: !!row, row: row?.textContent ?? '' };
      })()
    `);
    console.log('création produit:', JSON.stringify(prodCreated));
    expect('produit « Débardeur Vérif E12 » créé (tshirt/enfant, 2 ans)',
      prodCreated.found && prodCreated.row.includes('enfant') && prodCreated.row.includes('2 ans'));

    // ── 3. Image de patron dans l'atelier ───────────────────────────
    await send('Page.navigate', { url: 'http://localhost:3000/coupe' });
    await sleep(4000);
    const revisionLabel = await evaluate(`
      (async () => {
        const comboboxes = document.querySelectorAll('[role="combobox"]');
        const target = comboboxes[2];
        target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        target.click();
        await new Promise(r => setTimeout(r, 600));
        const options = [...document.querySelectorAll('li[role="option"]')];
        const choice = options.find(o => o.textContent.includes('#6')) ?? options[0];
        choice.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        choice.click();
        return choice.textContent;
      })()
    `);
    console.log('patron sélectionné:', revisionLabel);
    await sleep(2500);
    const imageState = await evaluate(`({
      title: [...document.querySelectorAll('p, span, h6')]
        .map(e => e.textContent).find(t => t && t.startsWith('Patron généré')) ?? '',
      img: (() => {
        const el = document.querySelector('img[src^="data:image/svg+xml"]');
        return el ? { loaded: el.complete && el.naturalWidth > 0,
          w: el.naturalWidth, h: el.naturalHeight } : null;
      })(),
    })`);
    console.log('image patron:', JSON.stringify(imageState));
    expect('image de patron générée automatiquement (SVG rendu)',
      imageState.title.includes('Patron généré') && imageState.img
      && imageState.img.loaded === true,
      `${imageState.img ? `${imageState.img.w}x${imageState.img.h}` : 'absente'}`);
    await screenshot('15-image-patron-atelier.png');

    ws.close();
    console.log(failures.length === 0
      ? 'VERIFICATION TERMINÉE — tous les contrôles OK'
      : `VERIFICATION TERMINÉE avec ${failures.length} échec(s): ${failures.join(' ; ')}`);
    process.exitCode = failures.length === 0 ? 0 : 1;
  } finally {
    edge.kill();
  }
}

main().catch((error) => {
  console.error('ÉCHEC:', error.message);
  process.exit(1);
});
