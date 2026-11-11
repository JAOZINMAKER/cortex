// Gera os ícones do CÓRTEX a partir de uma máscara 16x16 (pixel art brutalista: cérebro de perfil, cerebelo e tronco).
// Uso: node build/icone.js  → build/icon.png (512), build/icon.ico (16..256), app/icones/bandeja*.png
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const MASCARA = [
  '................',
  '.....######.....',
  '...##########...',
  '..###.###.####..',
  '.####.####.####.',
  '.##.#####o#.###.',
  '.######.######..',
  '.###.####.####..',
  '..#####.#####...',
  '...######.####..',
  '.....###.#####..',
  '.........##.##..',
  '.........##.....',
  '..........#.....',
  '................',
  '................',
];
const FUNDO = [12, 12, 11, 255], OSSO = [236, 232, 223, 255], LARANJA = [255, 106, 43, 255], GRADE = [40, 39, 35, 255];

function pixels(tam) {
  const buf = Buffer.alloc(tam * tam * 4);
  const cel = tam / 16;
  for (let y = 0; y < tam; y++) for (let x = 0; x < tam; x++) {
    const cx = Math.floor(x / cel), cy = Math.floor(y / cel);
    const ch = MASCARA[cy][cx];
    let c = FUNDO;
    // grade fina só nos tamanhos grandes
    if (tam >= 64 && (x % cel === 0 || y % cel === 0)) c = GRADE;
    if (ch === '#') c = OSSO;
    if (ch === 'o') c = LARANJA;
    // folga de 1px entre células nos tamanhos grandes: aspecto de matriz
    if ((ch === '#' || ch === 'o') && tam >= 128) {
      const gx = x % cel, gy = y % cel, f = Math.max(1, Math.round(cel * 0.08));
      if (gx < f || gy < f) c = FUNDO;
    }
    // moldura de 1 célula/16 em volta
    const b = Math.max(1, Math.round(tam / 64));
    if (tam >= 32 && (x < b || y < b || x >= tam - b || y >= tam - b)) c = LARANJA;
    buf.set(c, (y * tam + x) * 4);
  }
  return buf;
}

function crc32(b) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < b.length; n++) {
    c = (crc ^ b[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(tipo, dados) {
  const t = Buffer.from(tipo, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(dados.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, dados])));
  return Buffer.concat([len, t, dados, crc]);
}
function png(tam) {
  const px = pixels(tam);
  const linhas = Buffer.alloc((tam * 4 + 1) * tam);
  for (let y = 0; y < tam; y++) { linhas[y * (tam * 4 + 1)] = 0; px.copy(linhas, y * (tam * 4 + 1) + 1, y * tam * 4, (y + 1) * tam * 4); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(tam, 0); ihdr.writeUInt32BE(tam, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(linhas, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
function ico(tams) {
  const imgs = tams.map(png);
  const cab = Buffer.alloc(6); cab.writeUInt16LE(0, 0); cab.writeUInt16LE(1, 2); cab.writeUInt16LE(tams.length, 4);
  let off = 6 + 16 * tams.length;
  const dir = tams.map((t, i) => {
    const e = Buffer.alloc(16);
    e[0] = t >= 256 ? 0 : t; e[1] = t >= 256 ? 0 : t; e[2] = 0; e[3] = 0;
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(imgs[i].length, 8); e.writeUInt32LE(off, 12);
    off += imgs[i].length; return e;
  });
  return Buffer.concat([cab, ...dir, ...imgs]);
}

const raiz = path.resolve(__dirname, '..');
fs.mkdirSync(path.join(raiz, 'app', 'icones'), { recursive: true });
fs.writeFileSync(path.join(raiz, 'build', 'icon.png'), png(512));
fs.writeFileSync(path.join(raiz, 'build', 'icon.ico'), ico([16, 24, 32, 48, 64, 128, 256]));
fs.writeFileSync(path.join(raiz, 'app', 'icones', 'icone.png'), png(256));
fs.writeFileSync(path.join(raiz, 'app', 'icones', 'icone.ico'), ico([16, 24, 32, 48, 64, 128, 256]));
fs.writeFileSync(path.join(raiz, 'app', 'icones', 'bandeja.png'), png(16));
fs.writeFileSync(path.join(raiz, 'app', 'icones', 'bandeja@2x.png'), png(32));
fs.writeFileSync(path.join(raiz, 'app', 'icones', 'bandeja.ico'), ico([16, 24, 32]));
console.log('ícones gerados');
