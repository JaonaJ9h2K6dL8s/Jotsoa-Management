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
    backgroundColor: splashTheme.bg1,
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

// Palettes professionnelles du splash : une couleur différente est
// choisie au hasard à chaque lancement de l'application.
const SPLASH_THEMES = [
  { bg1: '#0a1633', bg2: '#13224a', bg3: '#1a2f63', accent: '#f4527a', accent2: '#ff7d9c', rgb: '244,82,122' },
  { bg1: '#17103a', bg2: '#251a5e', bg3: '#372a8f', accent: '#8b5cf6', accent2: '#b99cff', rgb: '139,92,246' },
  { bg1: '#062b22', bg2: '#0a3d30', bg3: '#115945', accent: '#1fae74', accent2: '#5fd7a8', rgb: '31,174,116' },
  { bg1: '#06203f', bg2: '#0a2f5e', bg3: '#114d8f', accent: '#3b82d6', accent2: '#7db4f5', rgb: '59,130,214' },
  { bg1: '#2b1606', bg2: '#452711', bg3: '#66391a', accent: '#ef8f2e', accent2: '#ffb866', rgb: '239,143,46' },
];

// Palette unique tirée au hasard pour ce lancement.
const splashTheme = SPLASH_THEMES[Math.floor(Math.random() * SPLASH_THEMES.length)];

// Écran de démarrage professionnel affiché immédiatement pendant le
// démarrage du serveur : logo Altenia Technologie animé, nom de
// l'application, barre de progression et version. Aucune ressource
// externe : logo recréé en CSS pur, tout fonctionne hors-ligne.
function showLoadingScreen() {
  if (!window || window.isDestroyed()) {
    return;
  }
  const version = app.getVersion();
  const theme = splashTheme;
  const loadingPage = `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>JO Management</title>
<style>
  :root{
    --bg-1:${theme.bg1}; --bg-2:${theme.bg2}; --bg-3:${theme.bg3};
    --accent:${theme.accent}; --accent-2:${theme.accent2};
    --accent-rgb:${theme.rgb}; --gold:#d4af37; --gold-soft:#e9cf7e;
    --text:#eef2fc; --muted:#a7b6d8;
  }
  html,body{height:100%;margin:0;overflow:hidden}
  body{
    background:radial-gradient(1300px 800px at 50% -20%, var(--bg-3) 0%, var(--bg-2) 48%, var(--bg-1) 100%);
    font-family:'Segoe UI',Arial,sans-serif;color:var(--text);
    display:flex;align-items:center;justify-content:center;
    -webkit-user-select:none;user-select:none;
  }
  .blob{position:fixed;border-radius:50%;filter:blur(90px);opacity:.35;pointer-events:none}
  .blob-a{width:430px;height:430px;left:-130px;top:-130px;
    background:rgba(var(--accent-rgb),.55);animation:drift-a 11s ease-in-out infinite}
  .blob-b{width:390px;height:390px;right:-120px;bottom:-120px;
    background:rgba(var(--accent-rgb),.35);animation:drift-b 13s ease-in-out infinite}
  @keyframes drift-a{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(55px,40px) scale(1.08)}}
  @keyframes drift-b{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(-50px,-35px) scale(1.1)}}
  .veil{
    position:fixed;inset:0;pointer-events:none;
    background:
      radial-gradient(1100px 620px at 50% 42%, rgba(255,255,255,.05) 0%, rgba(255,255,255,0) 62%),
      linear-gradient(rgba(255,255,255,.03) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255,255,255,.03) 1px, transparent 1px);
    background-size:auto,46px 46px,46px 46px;
    -webkit-mask-image:radial-gradient(950px 640px at 50% 46%, #000 26%, transparent 76%);
    mask-image:radial-gradient(950px 640px at 50% 46%, #000 26%, transparent 76%);
  }
  .flash{
    position:fixed;inset:0;pointer-events:none;z-index:6;
    background:radial-gradient(720px 430px at 50% 38%, rgba(255,255,255,.22), rgba(255,255,255,0) 62%);
    animation:flash 1.7s ease-out .05s both;
  }
  @keyframes flash{0%{opacity:0}16%{opacity:1}100%{opacity:0}}
  .particles{position:fixed;inset:0;pointer-events:none;overflow:hidden;z-index:2}
  .particles span{
    position:absolute;bottom:-14px;border-radius:50%;
    background:radial-gradient(circle,#ffe9a8 0%,var(--gold) 65%);
    box-shadow:0 0 7px rgba(245,208,97,.85);
    animation:rise-a linear infinite;
  }
  .particles span.alt{animation-name:rise-b}
  @keyframes rise-a{70%{opacity:.9}to{transform:translateY(-112vh) translateX(6vw);opacity:0}}
  @keyframes rise-b{70%{opacity:.9}to{transform:translateY(-112vh) translateX(-5vw);opacity:0}}
  .wrap{position:relative;display:flex;flex-direction:column;align-items:center;z-index:3}
  .logo-ring{
    position:relative;width:150px;height:150px;border-radius:50%;
    display:flex;align-items:center;justify-content:center;
    animation:logo-in .95s cubic-bezier(.2,.85,.3,1.12) both;
  }
  .logo-halo{
    position:absolute;inset:-48px;border-radius:50%;pointer-events:none;
    background:radial-gradient(circle, rgba(var(--accent-rgb),.30) 0%, rgba(var(--accent-rgb),0) 66%);
    animation:pulse 3.2s ease-in-out infinite;
  }
  @keyframes pulse{0%,100%{transform:scale(1);opacity:.75}50%{transform:scale(1.12);opacity:1}}
  .logo-ring::before{
    content:"";position:absolute;inset:-11px;border-radius:50%;
    background:conic-gradient(from 0deg, rgba(var(--accent-rgb),0) 0deg, rgba(var(--accent-rgb),.18) 190deg, rgba(var(--accent-rgb),.95) 325deg, rgba(var(--accent-rgb),0) 360deg);
    -webkit-mask:radial-gradient(farthest-side, transparent calc(100% - 2.5px), #000 calc(100% - 1.5px));
    mask:radial-gradient(farthest-side, transparent calc(100% - 2.5px), #000 calc(100% - 1.5px));
    animation:ring-spin 2.4s linear infinite;
  }
  .logo-ring::after{
    content:"";position:absolute;inset:-24px;border-radius:50%;
    border:1px solid rgba(212,175,55,.30);
    animation:gold-spin 14s linear infinite;
  }
  @keyframes gold-spin{to{transform:rotate(360deg)}}
  @keyframes ring-spin{to{transform:rotate(-360deg)}}
  @keyframes logo-in{0%{opacity:0;transform:scale(.5) translateY(14px)}100%{opacity:1;transform:scale(1) translateY(0)}}
  .logo-circle{
    width:128px;height:128px;border-radius:50%;background:#ffffff;
    position:relative;overflow:hidden;
    box-shadow:0 0 0 1.5px rgba(212,175,55,.45), 0 26px 64px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.10);
    display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;
    animation:float 5.5s ease-in-out 1s infinite;
  }
  @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
  .logo-circle::after{
    content:"";position:absolute;top:-40%;bottom:-40%;left:-70%;width:38%;
    background:linear-gradient(105deg, transparent 0%, rgba(212,175,55,.16) 42%, rgba(255,255,255,.85) 50%, rgba(212,175,55,.16) 58%, transparent 100%);
    transform:rotate(15deg);
    animation:sweep 4.6s ease-in-out 1.2s infinite;
  }
  @keyframes sweep{0%{left:-70%}55%,100%{left:150%}}
  .logo-name{
    color:#101828;font-weight:800;font-size:27px;letter-spacing:-.5px;line-height:1;
    font-family:Georgia,'Times New Roman',serif;
  }
  .logo-name span{display:block;height:2px;background:linear-gradient(90deg,#101828,var(--gold),#101828);margin:3px 6px 2px;border-radius:1px}
  .logo-sub{color:#101828;font-size:10.5px;font-weight:600;letter-spacing:.4px}
  h1{
    margin:22px 0 0;font-size:28px;font-weight:800;
    text-transform:uppercase;text-align:center;
    background:linear-gradient(90deg, var(--accent) 0%, var(--accent-2) 55%, var(--accent) 100%);
    background-size:220% auto;
    -webkit-background-clip:text;background-clip:text;
    -webkit-text-fill-color:transparent;
    animation:title-in .9s cubic-bezier(.2,.85,.3,1) .4s both, sheen 5.5s linear 1.8s infinite, glow-pulse 3.6s ease-in-out 2s infinite;
  }
  @keyframes title-in{0%{opacity:0;letter-spacing:16px;transform:translateY(10px)}100%{opacity:1;letter-spacing:4px;transform:translateY(0)}}
  @keyframes sheen{to{background-position:220% center}}
  @keyframes glow-pulse{
    0%,100%{filter:drop-shadow(0 0 10px rgba(var(--accent-rgb),.22))}
    50%{filter:drop-shadow(0 0 22px rgba(var(--accent-rgb),.45))}
  }
  .app-name{
    margin:8px 0 0;font-size:16px;font-weight:600;color:var(--text);
    animation:fade-up .7s ease .65s both;
  }
  .app-sub{
    margin:4px 0 0;font-size:13px;color:var(--muted);
    animation:fade-up .7s ease .8s both;
  }
  .vip-chip{
    margin-top:12px;padding:4px 16px;border-radius:999px;
    font-size:10px;font-weight:700;letter-spacing:3px;text-transform:uppercase;
    color:var(--gold-soft);border:1px solid rgba(212,175,55,.42);
    background:linear-gradient(90deg, rgba(212,175,55,.10), rgba(212,175,55,.04));
    animation:fade-up .7s ease .95s both;
  }
  .craft-wrap{
    position:relative;width:132px;height:132px;margin-top:18px;
    animation:fade-up .7s ease .35s both;
  }
  .craft-ring{position:absolute;inset:0;width:100%;height:100%}
  .craft-ring .ring-bg{stroke:rgba(255,255,255,.09)}
  .craft-ring .ring-fill{
    stroke:url(#ringGrad);
    stroke-dasharray:389.6;stroke-dashoffset:389.6;
    transition:stroke-dashoffset .35s ease;
    filter:drop-shadow(0 0 6px rgba(var(--accent-rgb),.55));
  }
  .craft-stage{
    position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
    width:106px;height:106px;border-radius:28px;
    background:rgba(255,255,255,.05);
    border:1px solid rgba(255,255,255,.09);
  }
  .craft-stage::after{
    content:"";position:absolute;inset:-20px;border-radius:50%;
    background:radial-gradient(circle, rgba(var(--accent-rgb),.20) 0%, rgba(var(--accent-rgb),0) 70%);
    opacity:0;transition:opacity .5s ease;
  }
  .craft-stage.active::after{opacity:1}
  .craft-icon{
    position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
    color:var(--muted);opacity:0;transform:scale(.55) rotate(-14deg);
    transition:opacity .5s ease, transform .55s cubic-bezier(.2,.8,.3,1.25), color .5s ease;
  }
  .craft-icon svg{width:52px;height:52px}
  .craft-icon.active{opacity:1;transform:scale(1) rotate(0deg);color:var(--accent)}
  .bar{
    width:312px;height:7px;margin-top:22px;border-radius:4px;overflow:hidden;
    background:rgba(255,255,255,.10);border:1px solid rgba(255,255,255,.07);
    animation:fade-up .7s ease 1s both;
  }
  .bar-fill{
    position:relative;height:100%;width:0%;border-radius:4px;
    background:linear-gradient(90deg, var(--accent) 0%, var(--accent-2) 100%);
    box-shadow:0 0 14px rgba(var(--accent-rgb),.65);
    transition:width .35s ease;
  }
  .bar-fill::after{
    content:"";position:absolute;top:0;bottom:0;left:-45%;width:38%;
    background:linear-gradient(100deg, transparent 0%, rgba(255,255,255,.55) 50%, transparent 100%);
    animation:bar-shine 1.7s linear infinite;
  }
  @keyframes bar-shine{to{left:135%}}
  .meta{
    width:312px;display:flex;justify-content:space-between;align-items:baseline;
    margin-top:10px;animation:fade-up .7s ease 1.1s both;
  }
  .status{font-size:13px;color:#c9d6f0;transition:opacity .25s ease}
  .pct{font-size:12px;font-weight:700;color:var(--gold-soft);letter-spacing:1px}
  .foot{
    position:fixed;bottom:20px;left:0;right:0;z-index:3;
    display:flex;align-items:center;justify-content:center;gap:14px;
    font-size:11.5px;color:#7386ad;letter-spacing:.6px;
    animation:fade-up .8s ease 1.6s both;
  }
  .foot::before,.foot::after{content:"";height:1px;width:64px}
  .foot::before{background:linear-gradient(90deg,transparent,rgba(212,175,55,.55))}
  .foot::after{background:linear-gradient(90deg,rgba(212,175,55,.55),transparent)}
  .foot b{color:#c9a84c;font-weight:600;letter-spacing:1.6px}
  @keyframes fade-up{0%{opacity:0;transform:translateY(12px)}100%{opacity:1;transform:translateY(0)}}
  body.leaving{transition:opacity .35s ease, transform .35s ease;opacity:0;transform:scale(1.02)}
  @media (prefers-reduced-motion: reduce){
    .blob-a,.blob-b,.flash,.logo-halo,.logo-ring::before,.logo-ring::after,.logo-circle,h1,.bar-fill::after{animation:none}
    .craft-icon,.bar-fill,.status,.craft-ring .ring-fill{transition:none}
  }
</style></head>
<body>
  <div class="blob blob-a"></div>
  <div class="blob blob-b"></div>
  <div class="veil"></div>
  <div class="flash"></div>
  <div class="particles" id="particles"></div>
  <div class="wrap">
    <div class="logo-ring">
      <div class="logo-halo"></div>
      <div class="logo-circle">
        <div class="logo-name">Altenia<span></span></div>
        <div class="logo-sub">Technologie</div>
      </div>
    </div>
    <h1>Altenia Technologie</h1>
    <p class="app-name">JO Management</p>
    <p class="app-sub">Gestion intégrée de l'entreprise textile</p>
    <div class="vip-chip">Édition Premium</div>
    <div class="craft-wrap">
      <svg class="craft-ring" viewBox="0 0 132 132" aria-hidden="true">
        <defs>
          <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" style="stop-color:var(--accent)"/>
            <stop offset="1" style="stop-color:var(--accent-2)"/>
          </linearGradient>
        </defs>
        <circle class="ring-bg" cx="66" cy="66" r="62" stroke-width="2.5" fill="none"/>
        <circle class="ring-fill" id="ringFill" cx="66" cy="66" r="62" stroke-width="2.5" fill="none" stroke-linecap="round" transform="rotate(-90 66 66)"/>
      </svg>
      <div class="craft-stage" id="craftStage">
        <div class="craft-icon"><svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4h12M6 20h12M8 6.5v11M16 6.5v11M8 10.5h8M8 14h8"/></svg></div>
        <div class="craft-icon"><svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="17.5" r="2.4"/><circle cx="18" cy="17.5" r="2.4"/><path d="M7.8 15.7 19 4.5M16.2 15.7 5 4.5"/></svg></div>
        <div class="craft-icon"><svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4 4 7.2 6 10l2-1.1V20h8V8.9L18 10l2-2.8L15 4a3 3 0 0 1-6 0z"/></svg></div>
        <div class="craft-icon"><svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 4 8.5 15.5"/><circle cx="6.7" cy="17.3" r="2.1"/><path d="M8.6 15.6c3.4.9 5.4-.8 4.6-3.6"/></svg></div>
        <div class="craft-icon"><svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><path d="M5.6 9.2c3.9 2 8.9 2 12.8 0M5.6 14.8c3.9-2 8.9-2 12.8 0"/></svg></div>
        <div class="craft-icon"><svg viewBox="0 0 24 24" stroke="currentColor" fill="none" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8.2 12 4l8 4.2v7.6L12 20l-8-4.2z"/><path d="M4 8.2l8 4 8-4M12 12.2V20"/></svg></div>
      </div>
    </div>
    <div class="bar"><div class="bar-fill" id="barFill"></div></div>
    <div class="meta">
      <span class="status" id="craftStatus">Initialisation…</span>
      <span class="pct" id="pctText">0 %</span>
    </div>
  </div>
  <div class="foot">Version ${version} · <b>ALTENIA TECHNOLOGIE</b></div>
<script>
(function(){
  var icons=document.querySelectorAll('.craft-icon');
  var stage=document.getElementById('craftStage');
  var status=document.getElementById('craftStatus');
  var fill=document.getElementById('barFill');
  var pctText=document.getElementById('pctText');
  var ring=document.getElementById('ringFill');
  var RING=389.6;
  var steps=[
    'Chargement des références produits',
    'Préparation des patrons de coupe',
    'Initialisation du catalogue',
    'Connexion à la base de données',
    'Synchronisation des ateliers',
    'Ouverture de votre espace de travail'
  ];
  var i=0,pct=0;
  var reduced=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function show(k){
    for(var q=0;q<icons.length;q++){icons[q].classList.toggle('active',q===k);}
    stage.classList.add('active');
    if(!reduced){
      status.style.opacity=0;
      setTimeout(function(){status.textContent=steps[k];status.style.opacity=1;},200);
    }else{
      status.textContent=steps[k];
    }
  }
  function tick(){show(i);i=(i+1)%icons.length;}
  if(reduced){show(0);}else{tick();setInterval(tick,1100);}
  function grow(){
    pct+=(97-pct)*0.05;
    fill.style.width=pct+'%';
    pctText.textContent=Math.round(pct)+' %';
    ring.style.strokeDashoffset=(RING*(1-pct/100)).toFixed(1);
  }
  setTimeout(function(){grow();setInterval(grow,260);},900);
  if(!reduced){
    var pc=document.getElementById('particles');
    for(var p=0;p<34;p++){
      var s=document.createElement('span');
      var size=(2+Math.random()*3.5).toFixed(1);
      s.style.cssText='left:'+(Math.random()*100).toFixed(2)+'%;width:'+size+'px;height:'+size+'px;'
        +'animation-duration:'+(7+Math.random()*9).toFixed(1)+'s;'
        +'animation-delay:-'+(Math.random()*12).toFixed(1)+'s;'
        +'opacity:'+(0.25+Math.random()*0.5).toFixed(2);
      if(p%2){s.className='alt';}
      pc.appendChild(s);
    }
  }
})();
</script>
</body></html>`)}`;
  window.loadURL(loadingPage);
}

// Fondu de sortie du splash avant de charger l'application réelle.
function fadeOutLoadingScreen() {
  if (!window || window.isDestroyed()) {
    return Promise.resolve();
  }
  return window.webContents
    .executeJavaScript(
      'var bf=document.getElementById("barFill");if(bf)bf.style.width="100%";'
      + 'var pt=document.getElementById("pctText");if(pt)pt.textContent="100 %";'
      + 'var rf=document.getElementById("ringFill");if(rf)rf.style.strokeDashoffset="0";'
      + 'document.body&&document.body.classList.add("leaving");true;',
    )
    .catch(() => {})
    .then(() => new Promise((resolve) => setTimeout(resolve, 320)));
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
    // Le serveur Next.js démarre en parallèle ; le splash reste affiché
    // au minimum 8 s pour que l'utilisateur voie le cycle complet des
    // 6 icônes textile (6 × 1,1 s) après l'animation d'entrée.
    await Promise.all([
      new Promise((resolve) => setTimeout(resolve, 8000)),
      waitForServer(),
    ]);
    await fadeOutLoadingScreen();
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
