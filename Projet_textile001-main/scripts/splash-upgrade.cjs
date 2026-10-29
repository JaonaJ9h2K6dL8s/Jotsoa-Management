// Remplace la fonction showLoadingScreen dans electron/main.cjs et le
// main.cjs packagé de V1_jotsoa par le contenu de scripts/_splash-new.txt.
// Usage : node scripts/splash-upgrade.cjs
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const fnText = fs.readFileSync(path.join(__dirname, '_splash-new.txt'), 'utf8').trimEnd();

const targets = [
  path.join(root, 'electron', 'main.cjs'),
  path.join(root, 'V1_jotsoa', 'win-unpacked', 'resources', 'app', 'electron', 'main.cjs'),
];

for (const file of targets) {
  let src = fs.readFileSync(file, 'utf8');
  const startMarker = 'function showLoadingScreen() {';
  const endMarker = '// Fondu de sortie du splash';
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`Marqueurs introuvables dans ${file}`);
  }
  if (src.indexOf(startMarker, start + 1) >= 0) {
    throw new Error(`Marqueur non unique dans ${file}`);
  }
  src = `${src.slice(0, start)}${fnText}\n\n${src.slice(end)}`;
  fs.writeFileSync(file, src);
  console.log(`mis à jour : ${file}`);
}
console.log('OK');
