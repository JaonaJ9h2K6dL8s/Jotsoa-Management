// Rastérise le logo Altenia (SVG) en PNG via canvas Chromium (rendu
// texte net), sans capture d'écran. Usage :
//   electron.exe scripts\icon-render.cjs <sortie.png> [taille]
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const outputPath = process.argv[2];
const size = Number(process.argv[3] || 512);
if (!outputPath) {
  console.error('Usage: electron icon-render.cjs <sortie.png> [taille]');
  process.exit(1);
}

const svgPath = path.join(__dirname, 'altenia-icon.svg');
const svg = fs.readFileSync(svgPath, 'utf8');
const sizedSvg = svg.replace('width="512" height="512"', `width="${size}" height="${size}"`);
const svgDataUrl = `data:image/svg+xml;base64,${Buffer.from(sizedSvg).toString('base64')}`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: size,
    height: size,
    show: false,
    webPreferences: { offscreen: true },
  });
  await win.loadURL('about:blank');
  const dataUrl = await win.webContents.executeJavaScript(
    `(async () => {
      const img = new Image();
      img.src = ${JSON.stringify(svgDataUrl)};
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = ${size};
      canvas.height = ${size};
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, ${size}, ${size});
      return canvas.toDataURL('image/png');
    })()`,
  );
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  fs.writeFileSync(outputPath, Buffer.from(base64, 'base64'));
  console.log(`OK → ${outputPath} (${size}x${size})`);
  app.quit();
});
