/**
 * Vérification navigateur (Edge headless + CDP) de l'étape 13 :
 * exploitation professionnelle des rouleaux sur /coupe/donnees —
 * vue détaillée (états, alertes), blocage/déblocage avec motif,
 * correction de stock historisée, historique des mouvements, et
 * colonne « Pièces (R2) » des produits.
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const PORT = 9235;
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
    `--user-data-dir=${profile}`, '--window-size=1600,1000',
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
    const clickButton = (text) => `
      [...document.querySelectorAll('button')]
        .filter(b => b.offsetParent !== null && b.textContent.trim() === '${text}')[0]
        ?.click(); 'clicked'`;
    const setReactInput = (input, value) => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
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
    await send('Page.navigate', { url: 'http://localhost:3000/coupe/donnees' });
    await sleep(4000);

    // 1. Vue détaillée : en-têtes nouveaux, états, créateur.
    const header = await evaluate(`(() => {
      const ths = [...document.querySelectorAll('table')[0].querySelectorAll('th')]
        .map(th => th.textContent);
      const firstRow = document.querySelectorAll('table')[0].querySelector('tbody tr');
      return {
        ths,
        rowCells: firstRow ? [...firstRow.querySelectorAll('td')].map(td => td.textContent) : [],
        chips: [...document.querySelectorAll('table')[0].querySelectorAll('tbody .MuiChip-label')]
          .map(c => c.textContent).slice(0, 8),
      };
    })()`);
    console.log('en-têtes:', JSON.stringify(header.ths));
    expect('colonnes détaillées (État, Poids init./restant, Longueur init./consommée/restante)',
      header.ths.some(t => t.includes('État'))
      && header.ths.some(t => t.includes('Poids init./restant'))
      && header.ths.some(t => t.includes('consommée')),
      header.ths.join('|'));
    expect('créateur et date affichés',
      header.rowCells.some(c => c.includes('chef.coupe')),
      (header.rowCells[8] ?? '').slice(0, 40));
    await screenshot('17-rouleaux-detailles.png');

    // 2. Créer un rouleau de test puis le bloquer avec motif.
    await evaluate(clickButton('Nouveau rouleau'));
    await sleep(400);
    await evaluate(`(() => {
      const inputs = [...document.querySelectorAll('.MuiDialog-container input')];
      const set = (i, v) => {
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype, 'value').set;
        setter.call(inputs[i], v);
        inputs[i].dispatchEvent(new Event('input', { bubbles: true }));
      };
      set(0, 'R-OPS-V13'); set(1, '15'); set(2, 'JERSEY-OPS');
      set(4, '40'); set(5, '180'); set(6, '170'); set(7, '200');
      return 'ok';
    })()`);
    await sleep(200);
    await evaluate(clickButton('Enregistrer'));
    await sleep(2000);

    const rowFor = (code) => `
      [...document.querySelectorAll('table')[0].querySelectorAll('tbody tr')]
        .find(tr => tr.textContent.includes('${code}'))`;
    const blockFlow = await evaluate(`(async () => {
      const row = ${rowFor('R-OPS-V13')};
      if (!row) return { found: false };
      [...row.querySelectorAll('button')].find(b => b.textContent === 'Bloquer').click();
      await new Promise(r => setTimeout(r, 500));
      const dialog = document.querySelector('.MuiDialog-container');
      if (!dialog) return { found: true, dialog: false };
      const reason = [...dialog.querySelectorAll('textarea, input[type="text"]')]
        .find(el => el.closest('.MuiTextField-root')?.textContent?.includes('Motif')
          || (el.tagName === 'TEXTAREA'));
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(reason, 'Réserve qualité vérification 13');
      reason.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 200));
      [...document.querySelectorAll('button')]
        .find(b => b.textContent.trim() === 'Confirmer').click();
      await new Promise(r => setTimeout(r, 2000));
      const row2 = ${rowFor('R-OPS-V13')};
      return {
        found: true, dialog: true,
        status: row2?.querySelector('.MuiChip-label')?.textContent ?? '',
        editGone: ![...row2.querySelectorAll('button')]
          .some(b => b.textContent === 'Modifier'),
      };
    })()`);
    console.log('blocage:', JSON.stringify(blockFlow));
    expect('rouleau créé puis bloqué (chip « bloque », bouton Modifier retiré)',
      blockFlow.found && blockFlow.status === 'bloque' && blockFlow.editGone === true);
    await screenshot('18-rouleau-bloque.png');

    // 3. Correction de stock avec motif : longueur restante 40 → 35.
    const adjustFlow = await evaluate(`(async () => {
      const row = ${rowFor('R-OPS-V13')};
      [...row.querySelectorAll('button')].find(b => b.textContent === 'Corriger').click();
      await new Promise(r => setTimeout(r, 500));
      const dialog = document.querySelector('.MuiDialog-container');
      const inputs = [...dialog.querySelectorAll('input')];
      const set = (el, v) => {
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype, 'value').set;
        setter.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      set(inputs.find(i => i.value === '40'), '35');
      const reason = dialog.querySelector('textarea');
      const taSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value').set;
      taSetter.call(reason, 'Relevé physique — vérification étape 13');
      reason.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 200));
      const confirmDisabled = [...document.querySelectorAll('button')]
        .find(b => b.textContent.trim() === 'Confirmer')?.disabled;
      [...document.querySelectorAll('button')]
        .find(b => b.textContent.trim() === 'Confirmer').click();
      await new Promise(r => setTimeout(r, 2000));
      const row2 = ${rowFor('R-OPS-V13')};
      return { confirmWasEnabled: confirmDisabled === false,
        cells: row2 ? [...row2.querySelectorAll('td')].map(td => td.textContent) : [] };
    })()`);
    console.log('correction:', JSON.stringify(adjustFlow));
    expect('motif requis puis correction appliquée (40 → 35 m)',
      adjustFlow.confirmWasEnabled === true
      && adjustFlow.cells.some(c => c.includes('40 / 5 / 35')),
      (adjustFlow.cells[5] ?? ''));

    // 4. Historique : les mouvements créés ci-dessus sont visibles.
    const historyFlow = await evaluate(`(async () => {
      const row = ${rowFor('R-OPS-V13')};
      [...row.querySelectorAll('button')].find(b => b.textContent === 'Historique').click();
      await new Promise(r => setTimeout(r, 800));
      const text = document.querySelector('.MuiDialog-container')?.textContent ?? '';
      const rows = document.querySelectorAll('.MuiDialog-container tbody tr').length;
      return { rows, hasBlock: text.includes('Blocage') && text.includes('Réserve qualité'),
        hasAdjust: text.includes('Correction') && text.includes('Relevé physique'),
        hasCreation: text.includes('Création') };
    })()`);
    console.log('historique:', JSON.stringify(historyFlow));
    expect('historique complet (création, correction avec motif, blocage avec motif)',
      historyFlow.rows >= 3 && historyFlow.hasCreation
      && historyFlow.hasBlock && historyFlow.hasAdjust);
    await screenshot('19-historique-mouvements.png');
    await evaluate(clickButton('Fermer'));
    await sleep(300);

    // 5. Déblocage puis nettoyage du rouleau de test (→ bloqué pour
    //    ne pas polluer les listes de l'atelier).
    const unblock = await evaluate(`(async () => {
      const row = ${rowFor('R-OPS-V13')};
      [...row.querySelectorAll('button')].find(b => b.textContent === 'Débloquer').click();
      await new Promise(r => setTimeout(r, 500));
      const dialog = document.querySelector('.MuiDialog-container');
      const reason = dialog.querySelector('textarea');
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(reason, 'Vérification terminée');
      reason.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 200));
      [...document.querySelectorAll('button')]
        .find(b => b.textContent.trim() === 'Confirmer').click();
      await new Promise(r => setTimeout(r, 2000));
      const row2 = ${rowFor('R-OPS-V13')};
      return { status: row2?.querySelector('.MuiChip-label')?.textContent ?? '' };
    })()`);
    expect('déblocage appliqué (état « disponible »)', unblock.status === 'disponible');

    // 6. Produits : colonne « Pièces (R2) ».
    const products = await evaluate(`(() => {
      const table = [...document.querySelectorAll('table')]
        .find(t => t.textContent.includes('Pièces (R2)'));
      if (!table) return { found: false };
      const row = [...table.querySelectorAll('tbody tr')]
        .find(tr => tr.textContent.includes('T-shirt'));
      return { found: true,
        cells: row ? [...row.querySelectorAll('td')].map(td => td.textContent) : [] };
    })()`);
    console.log('produits:', JSON.stringify(products));
    expect('colonne « Pièces (R2) » avec nombre de pièces obligatoires',
      products.found && products.cells.some(c => c.includes('obligatoire')),
      (products.cells[3] ?? ''));
    await screenshot('20-produits-pieces-r2.png');

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
