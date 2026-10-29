// Génère un aperçu HTML du splash (une instance par palette) pour
// validation visuelle. Usage : node scripts/splash-preview-gen.cjs
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8');

const marker = 'const loadingPage = `data:text/html;charset=utf-8,${encodeURIComponent(`';
const start = src.indexOf(marker);
if (start < 0) {
  console.error('Template du splash introuvable dans electron/main.cjs');
  process.exit(1);
}
const end = src.indexOf('`)}`', start);
if (end < 0) {
  console.error('Fin du template introuvable');
  process.exit(1);
}
const template = src.slice(start + marker.length, end);

const themes = [
  ['#0a1633', '#13224a', '#1a2f63', '#f4527a', '#ff7d9c', '244,82,122'],
  ['#17103a', '#251a5e', '#372a8f', '#8b5cf6', '#b99cff', '139,92,246'],
  ['#062b22', '#0a3d30', '#115945', '#1fae74', '#5fd7a8', '31,174,116'],
  ['#06203f', '#0a2f5e', '#114d8f', '#3b82d6', '#7db4f5', '59,130,214'],
  ['#2b1606', '#452711', '#66391a', '#ef8f2e', '#ffb866', '239,143,46'],
];

const fill = (html, t) => html
  .replaceAll('${version}', '0.1.0')
  .replaceAll('${theme.bg1}', t[0])
  .replaceAll('${theme.bg2}', t[1])
  .replaceAll('${theme.bg3}', t[2])
  .replaceAll('${theme.accent2}', t[4])
  .replaceAll('${theme.accent}', t[3])
  .replaceAll('${theme.rgb}', t[5]);

const pages = themes
  .map((t) => fill(template, t).replace('<div class="halo"></div>', '<div class="halo" style="position:absolute"></div>').replace('<!doctype html>', ''))
  .map((html) => `<div style="position:relative;width:420px;height:420px;overflow:hidden;display:flex;align-items:center;justify-content:center">${html}</div>`)
  .join('');

const out = path.join(root, 'verification-capture', 'splash-preview.html');
fs.writeFileSync(out, `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;display:flex;flex-wrap:wrap;background:#0b0b0b">${pages}</body></html>`);
console.log(`OK → ${out}`);
