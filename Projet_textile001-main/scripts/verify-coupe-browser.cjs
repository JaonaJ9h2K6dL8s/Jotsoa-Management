/**
 * Vérification navigateur (Edge headless + CDP) de l'atelier Coupe.
 * Scénario : connexion chef.coupe → /coupe → sélection rouleau/patron
 * → création plan → ajout de pièces → déplacement → zoom →
 * dépassement (contour rouge) → enregistrement → rechargement.
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const PORT = 9223;
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

    await getJson(`http://127.0.0.1:${PORT}/json/new?http://localhost:3000/login`, 'PUT');
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
    // Connexion par API puis injection du cookie de session (plus fiable
    // que les événements synthétiques sur le formulaire React).
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
    await send('Page.navigate', { url: 'http://localhost:3000/coupe' });
    await sleep(4000);
    console.log('url:', await evaluate('location.pathname'),
      '| titre:', await evaluate('document.title'));
    await screenshot('01-atelier-initial.png');

    const rollCount = await evaluate(
      `document.querySelectorAll('li[role="option"]').length`,
    );
    console.log('options visibles:', rollCount);

    // Sélection du rouleau (deuxième MUI select : Table, Rouleau, Patron, Ouvrir).
    await evaluate(`
      (async () => {
        const comboboxes = document.querySelectorAll('[role="combobox"]');
        comboboxes[1].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        comboboxes[1].click();
        await new Promise(r => setTimeout(r, 500));
        const options = [...document.querySelectorAll('li[role="option"]')];
        const target = options.find(o => o.textContent.includes('R-DEMO-2026')) ?? options[0];
        target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        target.click();
        return target.textContent;
      })()
    `);
    await sleep(500);
    // Sélection du patron validé (troisième select).
    const revisionLabel = await evaluate(`
      (async () => {
        const comboboxes = document.querySelectorAll('[role="combobox"]');
        comboboxes[2].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        comboboxes[2].click();
        await new Promise(r => setTimeout(r, 500));
        const options = [...document.querySelectorAll('li[role="option"]')];
        const target = options.find(o => o.textContent.includes('#6')) ?? options[0];
        target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        target.click();
        return target.textContent;
      })()
    `);
    console.log('patron sélectionné:', revisionLabel);
    await sleep(400);

    await evaluate(`
      [...document.querySelectorAll('button')]
        .find(b => b.textContent.includes('Nouveau plan')).click(); 'créé'
    `);
    await sleep(1200);
    await screenshot('02-plan-cree.png');

    // Ajout de deux pièces par double-clic dans la bibliothèque.
    const added = await evaluate(`
      (async () => {
        const cards = [...document.querySelectorAll('[draggable="true"]')];
        if (cards.length === 0) return 'aucune pièce';
        cards[0].dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        await new Promise(r => setTimeout(r, 300));
        cards[0].dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        await new Promise(r => setTimeout(r, 300));
        if (cards[1]) cards[1].dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        await new Promise(r => setTimeout(r, 300));
        return document.querySelectorAll('path[data-piece], g[data-piece]').length;
      })()
    `);
    console.log('pièces ajoutées:', added);
    await sleep(500);
    await screenshot('03-pieces-ajoutees.png');

    // Déplacement de la première pièce par glisser (Pointer Events).
    const drag = await evaluate(`
      (() => {
        const group = document.querySelector('g[data-piece]');
        if (!group) return 'aucune pièce sur la table';
        const path = group.querySelector('path');
        const box = path.getBoundingClientRect();
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      })()
    `);
    console.log('cible drag:', drag);
    const dispatchMouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', {
      type, x: Math.round(x), y: Math.round(y), button: 'left',
      buttons: type === 'mousePressed' || type === 'mouseMoved' ? 1 : 0,
      clickCount: type === 'mousePressed' || type === 'mouseReleased' ? 1 : 0,
      pointerType: 'mouse', ...extra,
    });
    if (typeof drag === 'object' && drag) {
      await dispatchMouse('mousePressed', drag.x, drag.y);
      for (let step = 1; step <= 12; step += 1) {
        await dispatchMouse('mouseMoved', drag.x + step * 25, drag.y + step * 3);
        await sleep(60);
      }
      await dispatchMouse('mouseReleased', drag.x + 300, drag.y + 36);
      await sleep(600);
      await screenshot('04-piece-deplacee.png');
    }

    // Dépassement volontaire de la zone (pièce hors tissu → rouge).
    if (typeof drag === 'object' && drag) {
      await dispatchMouse('mousePressed', drag.x + 300, drag.y + 36);
      for (let step = 1; step <= 12; step += 1) {
        await dispatchMouse('mouseMoved', drag.x + 300 + step * 30, drag.y + 36 - step * 22);
        await sleep(60);
      }
      await dispatchMouse('mouseReleased', drag.x + 660, drag.y + 36 - 264);
      await sleep(600);
      const stroke = await evaluate(
        `[...document.querySelectorAll('g[data-piece] path')]
           .map(p => p.getAttribute('stroke')).join(',')`,
      );
      console.log('contours après dépassement (rouge attendu quelque part):', stroke);
      await screenshot('05-depassement-rouge.png');
    }

    // Annulations successives jusqu'à retour à une position valide
    // (le premier déplacement débordait déjà la largeur du tissu).
    const undoToValid = await evaluate(`
      (async () => {
        const undo = [...document.querySelectorAll('button')]
          .find(b => b.textContent.includes('↶'));
        const strokes = () => [...document.querySelectorAll('g[data-piece] path')]
          .map(p => p.getAttribute('stroke'));
        const history = [];
        for (let i = 0; i < 6; i += 1) {
          const current = strokes();
          history.push(current.join(','));
          if (!current.includes('#dc2626')) break;
          if (undo.disabled) break;
          undo.click();
          await new Promise(r => setTimeout(r, 600));
        }
        return { final: strokes().join(','), history };
      })()
    `);
    console.log('retour à la validité:', JSON.stringify(undoToValid));

    // Zoom + Ajuster.
    await evaluate(`
      (async () => {
        const buttons = [...document.querySelectorAll('button')];
        buttons.find(b => b.textContent.trim() === '+').click();
        await new Promise(r => setTimeout(r, 300));
        buttons.find(b => b.textContent.includes('Ajuster')).click();
        return 'zoom ok';
      })()
    `);
    await sleep(500);
    await screenshot('06-zoom-ajuste.png');

    // Enregistrement explicite (le serveur revalide tout).
    const saved = await evaluate(`
      (async () => {
        const save = [...document.querySelectorAll('button')]
          .find(b => b.textContent.includes('Enregistrer'));
        if (!save || save.disabled) return 'bouton indisponible';
        save.click();
        await new Promise(r => setTimeout(r, 2000));
        const alert = document.querySelector('[role="alert"]');
        const topBar = [...document.querySelectorAll('h1, h2, p, span')]
          .map(el => el.textContent).find(t => t && t.startsWith('Plan de coupe #'));
        return (alert ? alert.textContent : 'pas de message') + ' | ' + (topBar ?? '');
      })()
    `);
    console.log('enregistrement:', saved);
    const planIdMatch = /Plan #(\d+) enregistré/.exec(saved ?? '')
      ?? /Plan de coupe #(\d+)/.exec(saved ?? '');
    const planId = planIdMatch ? planIdMatch[1] : '11';
    await screenshot('07-enregistre.png');

    // Annuler / Rétablir.
    const undoState = await evaluate(`
      (async () => {
        const buttons = [...document.querySelectorAll('button')];
        const undo = buttons.find(b => b.getAttribute('title') === 'Annuler' || b.textContent.includes('↶'));
        if (!undo) return 'undo introuvable';
        const disabledBefore = undo.disabled;
        undo.click();
        await new Promise(r => setTimeout(r, 400));
        return { disabledBefore };
      })()
    `);
    console.log('annuler:', JSON.stringify(undoState));
    await screenshot('08-apres-annuler.png');

    // Rechargement complet : le plan doit contenir les pièces enregistrées.
    await send('Page.navigate', { url: 'http://localhost:3000/coupe' });
    await sleep(4000);
    const reopened = await evaluate(`
      (async () => {
        const comboboxes = document.querySelectorAll('[role="combobox"]');
        const open = comboboxes[comboboxes.length - 1];
        open.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        open.click();
        await new Promise(r => setTimeout(r, 600));
        const options = [...document.querySelectorAll('li[role="option"]')];
        const target = options.find(o => o.textContent.includes('#${planId}')) ?? options[0];
        target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        target.click();
        await new Promise(r => setTimeout(r, 1500));
        return {
          ouvert: target.textContent,
          pieces: document.querySelectorAll('g[data-piece]').length,
        };
      })()
    `);
    console.log('rechargement:', JSON.stringify(reopened));
    await screenshot('09-plan-recharge.png');

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
