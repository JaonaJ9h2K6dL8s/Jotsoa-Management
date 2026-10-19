// Génère resources/icon.png (256×256) sans dépendance : carré arrondi
// émeraude à dégradé radial + anneau or, esthétique de marque JO.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const SIZE = 256;
const rows = [];
const radius = 52;

function clamp255(v) {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function insideRoundedSquare(x, y) {
  const min = 8;
  const max = SIZE - 8;
  if (x < min || x > max || y < min || y > max) return false;
  const cx = Math.max(min + radius, Math.min(x, max - radius));
  const cy = Math.max(min + radius, Math.min(y, max - radius));
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

for (let y = 0; y < SIZE; y++) {
  const row = Buffer.alloc(1 + SIZE * 4);
  row[0] = 0; // filtre PNG « None »
  for (let x = 0; x < SIZE; x++) {
    const offset = 1 + x * 4;
    if (!insideRoundedSquare(x, y)) {
      row[offset + 3] = 0;
      continue;
    }
    // Dégradé radial émeraude : centre éclairci, bords sombres.
    const dist = Math.hypot(x - SIZE * 0.5, y - SIZE * 0.38) / (SIZE * 0.75);
    let r = 10 + 15 * (1 - dist);
    let g = 92 + 60 * (1 - dist);
    let b = 60 + 35 * (1 - dist);
    // Anneau or centré.
    const ring = Math.abs(Math.hypot(x - SIZE / 2, y - SIZE / 2) - 72);
    if (ring < 4.5) {
      const blend = Math.max(0, 1 - ring / 4.5);
      r = r * (1 - blend) + 216 * blend;
      g = g * (1 - blend) + 196 * blend;
      b = b * (1 - blend) + 154 * blend;
    }
    row[offset] = clamp255(r);
    row[offset + 1] = clamp255(g);
    row[offset + 2] = clamp255(b);
    row[offset + 3] = 255;
  }
  rows.push(row);
}

const raw = Buffer.concat(rows);
const compressed = zlib.deflateSync(raw);

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc = Buffer.alloc(4);
  let acc = 0xffffffff;
  for (const byte of body) acc = crcTable[(acc ^ byte) & 0xff] ^ (acc >>> 8);
  crc.writeUInt32BE((acc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // profondeur
ihdr[9] = 6; // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', compressed),
  chunk('IEND', Buffer.alloc(0)),
]);

const target = path.join(__dirname, '..', 'resources', 'icon.png');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, png);
console.log('Icône écrite :', target);
