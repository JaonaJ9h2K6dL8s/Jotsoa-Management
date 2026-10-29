/**
 * Vérification navigateur (Edge headless + CDP) de l'étape 14 :
 * workflow en 10 étapes, indicateur de modifications non
 * enregistrées, règles graduées, fiche pièce complète (surface,
 * marges, statut de validation), raccourcis clavier (Ctrl+Z/Ctrl+Y),
 * et intégrité des révisions #7–#14 dans l'atelier.
 * Les interactions souris/clavier utilisent Input.dispatch* (événements
 * réels de confiance) : setPointerCapture et le drag HTML5 y répondent
 * comme avec un vrai périphérique.
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const PORT = 9237;
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
      if (result.exceptionDetails) throw new Error(`evaluate: ${result.exceptionDetails.text}`);
      return result.result.value;
    };
    const screenshot = async (name) => {
      const result = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(OUT, name), Buffer.from(result.data, 'base64'));
      console.log(`capture: ${name}`);
    };
    // Attend que la page ait hydraté les éléments attendus (au lieu
    // d'une attente fixe, sujette à la lenteur de démarrage du serveur).
    const waitFor = async (expression, label, timeoutMs = 20000) => {
      const deadline = Date.now() + timeoutMs;
      let last = null;
      while (Date.now() < deadline) {
        last = await evaluate(expression);
        if (last && last.ready) return last;
        await sleep(400);
      }
      throw new Error(`délai dépassé en attente de: ${label} (${JSON.stringify(last)})`);
    };
    // Centre d'un élément (renvoyé par la page) pour un clic réel CDP.
    const centerOf = async (findExpression, label) => {
      const rect = await evaluate(`(() => {
        const el = (${findExpression});
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
      })()`);
      if (!rect) throw new Error(`élément introuvable: ${label}`);
      return rect;
    };
    const clickAt = async (cx, cy, times = 1) => {
      const counts = times === 2 ? [1, 2] : [times];
      for (const count of counts) {
        await send('Input.dispatchMouseEvent', {
          type: 'mousePressed', x: cx, y: cy, button: 'left',
          buttons: 1, clickCount: count,
        });
        await send('Input.dispatchMouseEvent', {
          type: 'mouseReleased', x: cx, y: cy, button: 'left',
          buttons: 0, clickCount: count,
        });
        await sleep(60);
      }
    };
    const clickElement = async (findExpression, label, times = 1) => {
      const { cx, cy } = await centerOf(findExpression, label);
      await clickAt(cx, cy, times);
    };
    const pressCombo = async (key, code, vk, modifiers = 0) => {
      await send('Input.dispatchKeyEvent', {
        type: 'rawKeyDown', key, code, windowsVirtualKeyCode: vk,
        nativeVirtualKeyCode: vk, modifiers,
      });
      await send('Input.dispatchKeyEvent', {
        type: 'keyUp', key, code, windowsVirtualKeyCode: vk,
        nativeVirtualKeyCode: vk, modifiers,
      });
    };
    // Sélecteur MUI (TextField select) : clic réel puis clic sur l'option.
    const setSelect = async (index, filter) => {
      await clickElement(
        `document.querySelectorAll('[role="combobox"]')[${index}]`,
        `combobox #${index}`,
      );
      const option = await waitFor(`(() => {
        const found = [...document.querySelectorAll('li[role="option"]')]
          .find(o => o.textContent.includes(${JSON.stringify(filter)}));
        if (!found) return null;
        const r = found.getBoundingClientRect();
        return { ready: true, cx: r.x + r.width / 2, cy: r.y + r.height / 2,
          text: found.textContent };
      })()`, `option « ${filter} »`);
      // Le clic peut être raté pendant l'animation d'ouverture : réessai.
      let closed = false;
      for (let attempt = 0; attempt < 3 && !closed; attempt += 1) {
        await clickAt(option.cx, option.cy);
        try {
          await waitFor(`(() => ({
            ready: document.querySelectorAll('li[role="option"]').length === 0,
          }))()`, `fermeture du menu ${filter}`, 5000);
          closed = true;
        } catch { /* nouvel essai */ }
      }
      if (!closed) throw new Error(`menu ${filter} non refermé`);
      await sleep(300);
      return option.text;
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
    await waitFor(`(() => ({
      ready: document.querySelectorAll('.MuiChip-label').length >= 11
        && document.querySelectorAll('[role="combobox"]').length >= 3,
    }))()`, 'hydratation de /coupe (chips + combobox)', 45000);
    await sleep(800);

    // 1. Barre de workflow (10 étapes).
    const steps = await evaluate(`(() => {
      const chips = [...document.querySelectorAll('.MuiChip-label')]
        .map(c => c.textContent).filter(t => /^\\d+\\./.test(t ?? ''));
      return { count: chips.length, first: chips[0] ?? '', last: chips[chips.length - 1] ?? '' };
    })()`);
    expect('workflow 10 étapes affiché',
      steps.count === 10 && steps.first.startsWith('1.') && steps.last.startsWith('10.'),
      `${steps.count} étapes (${steps.first}…${steps.last})`);
    await screenshot('22-workflow-etapes.png');

    // 2. Créer un plan avec la révision #7 (tshirt-R2) puis déposer une pièce.
    // Ordre des combobox : 0 = Table (TopBar), 1 = Rouleau, 2 = Patron validé.
    // RL-0001 : rouleau de démonstration opérationnel (les R-OPS-* sont des
    // rouleaux de test, potentiellement bloqués).
    const roll = await setSelect(1, 'RL-0001');
    const rev = await setSelect(2, '#7');
    console.log('sélections:', JSON.stringify({ roll, rev }));
    // Création du plan avec réessai (le clic peut être avalé si un
    // menu est encore en train de se fermer).
    let paletteReady = false;
    for (let attempt = 0; attempt < 3 && !paletteReady; attempt += 1) {
      await clickElement(
        `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Nouveau plan')`,
        'bouton Nouveau plan',
      );
      try {
        await waitFor(`(() => ({
          ready: !!document.querySelector('[draggable="true"]'),
        }))()`, 'palette de pièces après création du plan', 6000);
        paletteReady = true;
      } catch { /* nouvel essai */ }
    }
    if (!paletteReady) throw new Error('palette de pièces absente après Nouveau plan');
    await sleep(600);

    // Déposer une pièce : double-clic sur la première carte de la palette
    // (onDoubleClick → dropPiece à 5,5) — avec réessai (MUI peut avaler
    // un clic pendant la fermeture d'un menu).
    let dropped = false;
    for (let attempt = 0; attempt < 3 && !dropped; attempt += 1) {
      await clickElement('document.querySelector(\'[draggable="true"]\')', 'carte pièce', 2);
      try {
        await waitFor(`(() => ({
          ready: document.querySelectorAll('g[data-piece]').length > 0,
        }))()`, 'pièce déposée sur la table', 6000);
        dropped = true;
      } catch { /* nouvel essai */ }
    }
    if (!dropped) throw new Error('pièce non déposée après 3 essais');
    await sleep(600);

    // 3. Indicateur de modifications non enregistrées.
    const dirty = await evaluate(`(() => {
      const chips = [...document.querySelectorAll('.MuiChip-label')]
        .map(c => c.textContent ?? '');
      return chips.some(t => t.includes('non enregistr'))
        || document.body.textContent.includes('modifications non enregistrées');
    })()`);
    expect('indicateur « modifications non enregistrées » visible', dirty === true);
    await screenshot('23-plan-non-enregistre.png');

    // 4. Raccourcis clavier : Ctrl+Z retire la pièce, Ctrl+Y la rétablit.
    // Testé AVANT la sauvegarde : l'enregistrement explicite devient la
    // nouvelle base et réinitialise l'historique (comportement attendu).
    // Le gestionnaire ignore les touches saisies dans un champ de
    // formulaire : on sort du sélecteur MUI d'abord (comme un
    // utilisateur qui clique ailleurs).
    await evaluate(`(() => {
      (document.activeElement)?.blur?.();
      document.body.focus?.();
      return String(document.activeElement?.tagName);
    })()`);
    const beforeCount = await evaluate(
      `document.querySelectorAll('g[data-piece]').length`);
    await pressCombo('z', 'KeyZ', 90, 2);
    await sleep(500);
    const afterUndo = await evaluate(
      `document.querySelectorAll('g[data-piece]').length`);
    await pressCombo('y', 'KeyY', 89, 2);
    await sleep(500);
    const afterRedo = await evaluate(
      `document.querySelectorAll('g[data-piece]').length`);
    expect('raccourcis Ctrl+Z / Ctrl+Y (annuler, rétablir)',
      beforeCount === 1 && afterUndo === 0 && afterRedo === 1,
      `avant=${beforeCount} après annul=${afterUndo} après rétab=${afterRedo}`);

    // 5. Enregistrer puis vérifier que l'indicateur disparaît.
    await clickElement(
      `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Enregistrer')`,
      'bouton Enregistrer',
    );
    await waitFor(`(() => ({
      ready: !document.body.textContent.includes('modifications non enregistrées'),
    }))()`, 'disparition de l\'indicateur après enregistrement');
    const savedBadge = await evaluate(`(() =>
      document.body.textContent.includes('enregistré')
      || !document.body.textContent.includes('modifications non enregistrées'))()`);
    expect('indicateur disparu après enregistrement explicite', savedBadge === true);

    // 5. Règles graduées (textes de graduation dans le SVG).
    const rulers = await evaluate(`(() => {
      const texts = [...document.querySelectorAll('svg text')]
        .map(t => t.textContent ?? '');
      const numeric = texts.filter(t => /^\\d+$/.test(t));
      return { count: numeric.length, sample: numeric.slice(0, 6) };
    })()`);
    expect('règles graduées (graduations numériques dans le canvas)',
      rulers.count >= 6, JSON.stringify(rulers.sample));
    await screenshot('24-regles-graduees.png');

    // 6. Sélectionner la pièce (clic réel au centre du contour) → fiche complète.
    const pieceCenter = await evaluate(`(() => {
      const path = document.querySelector('g[data-piece] path');
      if (!path) return null;
      const b = path.getBoundingClientRect();
      return { cx: b.x + b.width / 2, cy: b.y + b.height / 2 };
    })()`);
    if (!pieceCenter) throw new Error('contour de pièce introuvable sur la table');
    await clickAt(pieceCenter.cx, pieceCenter.cy);
    await sleep(600);
    const info = await evaluate(`(() => {
      const body = document.body.textContent;
      return {
        surface: body.includes('Surface du contour'),
        seams: body.includes('Marges de couture'),
        status: body.includes('Validée pour la production')
          || body.includes('Non validé pour la production'),
      };
    })()`);
    console.log('fiche pièce:', JSON.stringify(info));
    expect('fiche pièce complète (surface, marges, statut de validation)',
      info.surface && info.seams && info.status);
    await screenshot('25-fiche-piece.png');

    // 8. Intégrité : les révisions #7–#14 sont proposées dans le sélecteur.
    await clickElement(
      `document.querySelectorAll('[role="combobox"]')[2]`,
      'combobox Patron validé',
    );
    const revisions = await waitFor(`(() => {
      const items = [...document.querySelectorAll('li[role="option"]')];
      if (items.length === 0) return null;
      return { ready: true, labels: items.map(o => o.textContent ?? '') };
    })()`, 'liste des révisions');
    await pressCombo('Escape', 'Escape', 27);
    const ids = revisions.labels.map((label) => Number((label.match(/#(\d+)/) ?? [])[1]))
      .filter((value) => Number.isFinite(value));
    expect('révisions #7–#14 disponibles dans l’atelier',
      [7, 8, 9, 10, 11, 12, 13, 14].every((value) => ids.includes(value)),
      `ids: ${ids.join(',')}`);
    await screenshot('26-revisions-disponibles.png');

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
