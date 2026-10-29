// Assemble un fichier .ico multi-tailles à partir de PNG rendus par
// Electron (format ICO avec entrées compressées PNG, supporté par
// Windows Vista et plus). Usage :
//   electron.exe scripts\ico-build.cjs <sortie.ico>
// Les PNG sont générés depuis scripts\altenia-icon.svg.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const outputPath = process.argv[2];
const SIZES = [16, 24, 32, 48, 64, 128, 256];
if (!outputPath) {
  console.error('Usage: electron ico-build.cjs <sortie.ico>');
  process.exit(1);
}

const svgPath = path.join(__dirname, 'altenia-icon.svg');
const svg = fs.readFileSync(svgPath, 'utf8');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 256,
    height: 256,
    show: false,
    webPreferences: { offscreen: true },
  });
  await win.loadURL('about:blank');

  const pngs = [];
  for (const size of SIZES) {
    const sizedSvg = svg.replace(
      'width="512" height="512"',
      `width="${size}" height="${size}"`,
    );
    const svgDataUrl = `data:image/svg+xml;base64,${Buffer.from(sizedSvg).toString('base64')}`;
    const dataUrl = await win.webContents.executeJavaScript(
      `(async () => {
        const img = new Image();
        img.src = ${JSON.stringify(svgDataUrl)};
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = ${size};
        canvas.height = ${size};
        canvas.getContext('2d').drawImage(img, 0, 0, ${size}, ${size});
        return canvas.toDataURL('image/png');
      })()`,
    );
    pngs.push(Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64'));
    console.log(`  rendu ${size}x${size} OK`);
  }

  // Assemblage ICO : en-tête + répertoire + données PNG.
  const headerSize = 6 + 16 * SIZES.length;
  const totalSize =
    headerSize + pngs.reduce((sum, png) => sum + png.length, 0);
  const ico = Buffer.alloc(totalSize);
  let offset = 0;

  ico.writeUInt16LE(0, offset); // reserved
  ico.writeUInt16LE(1, offset + 2); // type = icon
  ico.writeUInt16LE(SIZES.length, offset + 4); // image count
  offset = headerSize;

  let directoryOffset = 6;
  for (let i = 0; i < SIZES.length; i += 1) {
    const size = SIZES[i];
    const png = pngs[i];
    ico.writeUInt8(size >= 256 ? 0 : size, directoryOffset); // width
    ico.writeUInt8(size >= 256 ? 0 : size, directoryOffset + 1); // height
    ico.writeUInt8(0, directoryOffset + 2); // palette
    ico.writeUInt8(0, directoryOffset + 3); // reserved
    ico.writeUInt16LE(1, directoryOffset + 4); // color planes
    ico.writeUInt16LE(32, directoryOffset + 6); // bits per pixel
    ico.writeUInt32LE(png.length, directoryOffset + 8); // data size
    ico.writeUInt32LE(offset, directoryOffset + 12); // data offset
    png.copy(ico, offset);
    offset += png.length;
    directoryOffset += 16;
  }

  fs.writeFileSync(outputPath, ico);
  console.log(`OK → ${outputPath} (${SIZES.length} tailles)`);
  app.quit();
});
