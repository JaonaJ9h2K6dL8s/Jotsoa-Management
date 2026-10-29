/**
 * Vérification navigateur du flux « Optimiser le placement » (étape 4).
 * Ouvre un plan existant, ajoute des pièces, lance l'optimiseur,
 * contrôle le panneau de comparaison, accepte, enregistre.
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const PORT = 9227;
const OUT = path.join(__dirname, '..', 'verification-capture');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getJson(url, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  const EDGE = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].find((p) => fs.existsSync(p));
  const edge = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${PORT}`,
    '--user-data-dir=' + path.join(OUT, 'edge-opt'),
    '--window-size=1600,900', 'about:blank',
  ], { stdio: 'ignore' });

  try {
    let version = null;
    for (let i = 0; i < 40 && !version; i += 1) {
      await sleep(500);
      try { version = await getJson(`http://127.0.0.1:${PORT}/json/version`); } catch { /* retry */ }
    }
    if (!version) throw new Error('CDP indisponible');
    await getJson(`http://127.0.0.1:${PORT}/json/new?http://localhost:3000/`, 'PUT');
    await sleep(800);
    const target = (await getJson(`http://127.0.0.1:${PORT}/json/list`))
      .find((item) => item.type === 'page');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let nextId = 1;
    const pending = new Map();
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.method === 'Runtime.exceptionThrown') {
        const details = message.params.exceptionDetails;
        console.error('browser exception:', details.text,
          details.exception?.description ?? details.stackTrace?.callFrames?.[0]?.url ?? '');
      }
      if (message.method === 'Network.responseReceived'
        && message.params.response.url.includes('/api/cutting/')) {
        console.log('API:', message.params.response.status, message.params.response.url);
      }
      if (message.id && pending.has(message.id)) {
        const { resolve, reject } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
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
        throw new Error(`evaluate: ${result.exceptionDetails.exception?.description
          ?? result.exceptionDetails.text}`);
      }
      return result.result.value;
    };
    const waitFor = async (expression, label, timeoutMs = 45000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const ready = await evaluate(expression);
        if (ready) return;
        await sleep(250);
      }
      const currentUrl = await evaluate('location.href');
      const currentText = await evaluate('document.body.innerText.slice(0, 800)');
      throw new Error(`délai dépassé en attendant: ${label} (${currentUrl}) ${currentText}`);
    };
    const screenshot = async (name) => {
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(OUT, name), Buffer.from(shot.data, 'base64'));
      console.log(`capture: ${name}`);
    };

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.enable');
    const login = await fetch('http://localhost:3000/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'chef.coupe', password: 'Coupe-2026!' }),
    });
    if (!login.ok) throw new Error(`login: ${login.status} ${await login.text()}`);
    const raw = login.headers.getSetCookie().find((c) => !c.startsWith('Path='));
    const [nv] = raw.split(';');
    const eq = nv.indexOf('=');
    await send('Network.setCookie', {
      name: nv.slice(0, eq), value: nv.slice(eq + 1), url: 'http://localhost:3000', path: '/',
    });

    await send('Page.navigate', { url: 'http://localhost:3000/coupe' });
    await waitFor(`(() => document.querySelectorAll('[role="combobox"]').length >= 3)()`,
      'hydratation des sélecteurs de /coupe');
    await sleep(500);

    await evaluate(`
      (async () => {
        const pick = async (index, text) => {
          const combos = document.querySelectorAll('[role="combobox"]');
          combos[index].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
          combos[index].click();
          await new Promise(r => setTimeout(r, 500));
          const options = [...document.querySelectorAll('li[role="option"]')];
          const target = options.find(o => o.textContent.includes(text));
          if (!target) throw new Error('option absente: ' + text);
          target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
          target.click();
          await new Promise(r => setTimeout(r, 500));
        };
        await pick(1, 'R-DEMO-2026');
        await pick(2, '#6');
        const create = [...document.querySelectorAll('button')]
          .find(button => button.textContent.trim() === 'Nouveau plan');
        if (!create || create.disabled) throw new Error('création de plan indisponible');
        create.click();
        await new Promise(r => setTimeout(r, 1800));
        if (!document.body.innerText.includes('Plan de coupe #')) {
          throw new Error('plan de test non créé');
        }
        return 'nouveau brouillon de test créé';
      })()
    `);
    await sleep(400);

    // Ajout de 2 pièces par double-clic (état de départ volontairement
    // sous-optimal pour comparer).
    const added = JSON.parse(await evaluate(`
      (async () => {
        const cards = [...document.querySelectorAll('[draggable="true"]')];
        for (const card of cards.slice(0, 2)) {
          card.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 }));
          await new Promise(r => setTimeout(r, 400));
        }
        return JSON.stringify({ cards: cards.length, placed: document.querySelectorAll('g[data-piece]').length });
      })()
    `));
    if (added.placed === 0) throw new Error(`pièce non ajoutée (${added.cards} cartes disponibles)`);
    await sleep(500);
    await screenshot('10-avant-optimisation.png');
    const before = await evaluate(`
      JSON.stringify({
        pieces: document.querySelectorAll('g[data-piece]').length,
        shapes: [...document.querySelectorAll('g[data-piece]')]
          .map(node => node.querySelector('path')?.getAttribute('d') ?? ''),
      })
    `);
    console.log('avant optimisation:', before);

    // Clic sur « Optimiser le placement ».
    const optimizeResult = await evaluate(`
      (async () => {
        const button = [...document.querySelectorAll('button')]
          .find(b => b.textContent.includes('Optimiser le placement'));
        if (!button || button.disabled) return 'bouton indisponible';
        button.click();
        await new Promise(r => setTimeout(r, 8000));
        const panel = [...document.querySelectorAll('button')]
          .some(b => b.textContent.trim() === 'Accepter');
        const heading = [...document.querySelectorAll('h6, h5, h4, h3, p')]
          .map(node => node.textContent.trim())
          .find(text => /Proposition/.test(text)) ?? 'titre absent';
        const method = heading;
        const compute = document.body.innerText.match(/calcul\s+\d+\s+ms/)?.[0]?.replace(/\s+/g, ' ') ?? 'calcul ?';
        const indicators = document.body.innerText.match(/Taux d'utilisation[^%]*%/)?.[0];
        const unplaced = document.body.innerText.includes('Pièces non placées');
        return JSON.stringify({ panel, method, compute, indicators, unplaced });
      })()
    `);
    console.log('optimisation:', optimizeResult);
    await screenshot('11-proposition-optimisee.png');

    const rejected = await evaluate(`
      (async () => {
        const reject = [...document.querySelectorAll('button')]
          .find(b => b.textContent.trim() === 'Rejeter');
        if (!reject || reject.disabled) return 'reject indisponible';
        reject.click();
        await new Promise(r => setTimeout(r, 1200));
        return JSON.stringify({
          panelGone: ![...document.querySelectorAll('button')]
            .some(b => b.textContent.trim() === 'Accepter'),
          shapes: [...document.querySelectorAll('g[data-piece]')]
          .map(node => node.querySelector('path')?.getAttribute('d') ?? ''),
        });
      })()
    `);
    const rejectionState = JSON.parse(rejected);
    const originalState = JSON.parse(before);
    if (!rejectionState.panelGone
      || JSON.stringify(rejectionState.shapes) !== JSON.stringify(originalState.shapes)) {
      throw new Error('Rejeter a modifié le placement courant ou conservé la proposition.');
    }
    console.log('annulation:', 'proposition rejetée sans modifier le plan courant');

    await evaluate(`
      (async () => {
        const button = [...document.querySelectorAll('button')]
          .find(b => b.textContent.includes('Optimiser le placement'));
        if (!button || button.disabled) throw new Error('bouton optimisation indisponible après rejet');
        button.click();
        await new Promise(r => setTimeout(r, 8000));
        if (![...document.querySelectorAll('button')]
          .some(b => b.textContent.trim() === 'Accepter')) {
          throw new Error('proposition absente après nouvel essai');
        }
        return 'proposition régénérée';
      })()
    `);

    // Acceptation : recontrôle serveur puis retour au plan courant.
    const accepted = await evaluate(`
      (async () => {
        const accept = [...document.querySelectorAll('button')]
          .find(b => b.textContent.trim() === 'Accepter');
        if (!accept || accept.disabled) return 'accept indisponible';
        accept.click();
        await new Promise(r => setTimeout(r, 2000));
        const alert = document.querySelector('[role="alert"]');
        return alert ? alert.textContent : 'pas de message';
      })()
    `);
    console.log('acceptation:', accepted);
    await screenshot('12-proposition-acceptee.png');

    // Enregistrement explicite.
    const saved = await evaluate(`
      (async () => {
        const save = [...document.querySelectorAll('button')]
          .find(b => b.textContent.includes('Enregistrer'));
        if (!save || save.disabled) return 'bouton indisponible';
        save.click();
        await new Promise(r => setTimeout(r, 2000));
        const alert = document.querySelector('[role="alert"]');
        return alert ? alert.textContent : 'pas de message';
      })()
    `);
    console.log('enregistrement:', saved);
    await screenshot('13-plan-optimise-enregistre.png');

    ws.close();
    console.log('VERIFICATION OPTIMISATION TERMINÉE');
  } finally {
    edge.kill();
  }
}

main().catch((error) => {
  console.error('ÉCHEC:', error.message);
  process.exit(1);
});
