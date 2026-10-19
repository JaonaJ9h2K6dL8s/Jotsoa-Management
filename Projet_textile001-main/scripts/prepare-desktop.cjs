// Préparation du paquet desktop : copie des fichiers statiques dans la
// sortie autonome de Next.js, puis alignement du module natif
// better-sqlite3 (recompilé pour l'ABI Electron) dans cette sortie.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const STANDALONE = path.join(ROOT, '.next', 'standalone');

function copyDir(source, target) {
  fs.cpSync(source, target, { recursive: true });
}

if (!fs.existsSync(path.join(STANDALONE, 'server.js'))) {
  console.error('ERREUR : .next/standalone introuvable. Lancez `next build` avant.');
  process.exit(1);
}

copyDir(path.join(ROOT, '.next', 'static'), path.join(STANDALONE, '.next', 'static'));
if (fs.existsSync(path.join(ROOT, 'public'))) {
  copyDir(path.join(ROOT, 'public'), path.join(STANDALONE, 'public'));
}

const nodeBinary = path.join(
  ROOT,
  'node_modules',
  'better-sqlite3',
  'build',
  'Release',
  'better_sqlite3.node',
);
const targetBinary = path.join(
  STANDALONE,
  'node_modules',
  'better-sqlite3',
  'build',
  'Release',
  'better_sqlite3.node',
);
if (fs.existsSync(nodeBinary) && !fs.existsSync(targetBinary)) {
  fs.mkdirSync(path.dirname(targetBinary), { recursive: true });
  fs.copyFileSync(nodeBinary, targetBinary);
}

// Runtime Node embarqué : l'exe portable lance le serveur avec ce Node,
// ce qui évite de recompiler better-sqlite3 pour l'ABI d'Electron
// (Visual Studio absent sur le poste de build).
const resourcesDir = path.join(ROOT, 'resources');
fs.mkdirSync(resourcesDir, { recursive: true });
const nodeTarget = path.join(resourcesDir, 'node.exe');
if (!fs.existsSync(nodeTarget)) {
  const which = require('node:child_process').execSync('where node', { encoding: 'utf8' });
  const nodePath = which.split(/\r?\n/)[0].trim();
  fs.copyFileSync(nodePath, nodeTarget);
  console.log('Runtime Node embarqué :', nodePath);
}
console.log('Préparation desktop terminée.');
