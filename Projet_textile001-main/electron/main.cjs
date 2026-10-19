// eslint-disable-next-line @typescript-eslint/no-require-imports
const { app, BrowserWindow, Menu } = require('electron');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { spawn } = require('node:child_process');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const http = require('node:http');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('node:path');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('node:fs');

/**
 * Lancement desktop (Windows) : l'application JO Management tourne dans
 * une fenêtre Electron. Le serveur Next.js démarre en arrière-plan via
 * le runtime Node intégré à Electron, puis la fenêtre s'y connecte en
 * local (pas d'Internet requis). Les autres postes du réseau local
 * peuvent toujours se connecter au même serveur depuis leur navigateur.
 */

const PORT = 3000;
const isDev = !app.isPackaged;
const ROOT = isDev ? path.join(__dirname, '..') : process.resourcesPath;

// Exe portable : les données (base SQLite) vivent à côté du fichier .exe,
// pas dans un dossier temporaire qui serait vidé.
const dataRoot =
  !isDev && process.env.PORTABLE_EXECUTABLE_DIR
    ? path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'data')
    : path.join(ROOT, 'data');

let serverProcess = null;
let window = null;

function startServer() {
  // Développement : `next start` via le Node du système. Paquet : serveur
  // autonome Next (server.js) lancé avec le runtime Node embarqué dans
  // resources/ — better-sqlite3 est compilé pour ce Node, aucun Visual
  // Studio n'est requis.
  let runtime;
  let args;
  let cwd;
  if (isDev) {
    runtime = 'node.exe';
    args = [path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next'), 'start', '-H', '0.0.0.0', '-p', String(PORT)];
    cwd = ROOT;
  } else {
    const appDir = path.join(process.resourcesPath, 'app');
    const standaloneDir = path.join(appDir, '.next', 'standalone');
    runtime = path.join(process.resourcesPath, 'node.exe');
    args = [path.join(standaloneDir, 'server.js')];
    cwd = standaloneDir;
  }
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    DATABASE_PATH: path.join(dataRoot, 'jo-management.db'),
    HOSTNAME: '0.0.0.0',
    PORT: String(PORT),
  };

  serverProcess = spawn(runtime, args, {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProcess.stdout.on('data', (chunk) => process.stdout.write(`[serveur] ${chunk}`));
  serverProcess.stderr.on('data', (chunk) => process.stderr.write(`[serveur] ${chunk}`));
  serverProcess.on('exit', (code) => {
    if (code !== 0 && code !== null && !app.isQuitting) {
      // Redémarrage du serveur en cas de crash inattendu.
      setTimeout(startServer, 2000);
    }
  });
}

function waitForServer(attempt = 0) {
  return new Promise((resolve, reject) => {
    const request = http.get(`http://127.0.0.1:${PORT}/login`, (response) => {
      response.resume();
      resolve();
    });
    request.on('error', () => {
      if (attempt > 600) {
        reject(new Error('Serveur introuvable après 120 s.'));
        return;
      }
      setTimeout(() => waitForServer(attempt + 1).then(resolve, reject), 200);
    });
  });
}

function createWindow() {
  window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: '#eef1f8',
    title: 'JO Management',
    icon: path.join(ROOT, 'resources', 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const menuTemplate = [];
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));

  window.once('ready-to-show', () => window.show());
  window.on('closed', () => {
    window = null;
  });
}

// Écran d'attente affiché immédiatement pendant le démarrage du serveur :
// la fenêtre est visible sans attendre que Next.js soit prêt.
function showLoadingScreen() {
  if (!window || window.isDestroyed()) {
    return;
  }
  const loadingPage = `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>JO Management</title>
<style>
  html,body{height:100%;margin:0;background:#eef1f8;font-family:Segoe UI,Arial,sans-serif}
  .wrap{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px}
  .bar{width:220px;height:6px;border-radius:3px;background:#d5dbeb;overflow:hidden}
  .bar::after{content:"";display:block;width:40%;height:100%;border-radius:3px;background:#1f4fd8;animation:slide 1.1s ease-in-out infinite}
  @keyframes slide{0%{transform:translateX(-100%)}100%{transform:translateX(350%)}}
  p{color:#3c4a6b;font-size:14px;margin:0}
</style></head>
<body><div class="wrap"><div class="bar"></div><p>Démarrage de JO Management…</p></div></body></html>`)}`;
  window.loadURL(loadingPage);
}

function loadApplication() {
  if (!window || window.isDestroyed()) {
    return;
  }
  window.loadURL(`http://127.0.0.1:${PORT}`);
}

app.on('before-quit', () => {
  app.isQuitting = true;
});

app.on('window-all-closed', () => {
  app.quit();
});

process.on('exit', () => {
  if (serverProcess) serverProcess.kill();
});

app.whenReady().then(async () => {
  try {
    startServer();
    // La fenêtre apparaît tout de suite (écran d'attente), le serveur
    // Next.js démarre en parallèle ; l'application se charge dès qu'il
    // répond — au lieu d'une fenêtre absente pendant tout le boot.
    createWindow();
    showLoadingScreen();
    await waitForServer();
    loadApplication();
    if (process.env.JO_SMOKE === '1') {
      // Test automatisé : serveur démarré → succès puis arrêt.
      process.stdout.write('SMOKE_OK\n');
      setTimeout(() => app.quit(), 1500);
    }
  } catch (error) {
    process.stderr.write(`${error}\n`);
    app.quit();
  }
});
