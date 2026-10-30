const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const size = 256;
const stride = size * 4 + 1;
const raw = Buffer.alloc(stride * size);

function insideRoundedSquare(x, y, radius = 48) {
  const cx = x < radius ? radius : x >= size - radius ? size - radius - 1 : x;
  const cy = y < radius ? radius : y >= size - radius ? size - radius - 1 : y;
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
}

for (let y = 0; y < size; y += 1) {
  const row = y * stride;
  raw[row] = 0;
  for (let x = 0; x < size; x += 1) {
    const offset = row + 1 + x * 4;
    if (!insideRoundedSquare(x, y)) continue;
    const sheen = Math.max(0, 18 - Math.hypot(x - 70, y - 52) / 7);
    raw[offset] = 12 + sheen;
    raw[offset + 1] = 13 + sheen;
    raw[offset + 2] = 16 + sheen;
    raw[offset + 3] = 255;
  }
}

function paintRect(x1, y1, x2, y2, color) {
  for (let y = y1; y < y2; y += 1) {
    for (let x = x1; x < x2; x += 1) {
      const offset = y * stride + 1 + x * 4;
      raw[offset] = color[0];
      raw[offset + 1] = color[1];
      raw[offset + 2] = color[2];
      raw[offset + 3] = color[3];
    }
  }
}

const silver = [184, 188, 194, 255];
const silverLight = [220, 222, 224, 255];

// Minimal, monoline 47 mark.
paintRect(57, 60, 70, 136, silver);
paintRect(57, 123, 126, 136, silver);
paintRect(110, 51, 124, 204, silver);
paintRect(145, 57, 207, 71, silver);
for (let y = 68; y < 204; y += 1) {
  const center = 199 - Math.round((y - 68) * 43 / 136);
  paintRect(center - 7, y, center + 7, y + 1, silver);
}

// A restrained metallic highlight, without introducing a second color.
paintRect(60, 61, 63, 132, silverLight);
paintRect(60, 125, 119, 128, silverLight);
paintRect(113, 54, 116, 199, silverLight);
paintRect(148, 60, 201, 63, silverLight);

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(size, 0);
ihdr.writeUInt32BE(size, 4);
ihdr[8] = 8;
ihdr[9] = 6;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
]);

const icoHeader = Buffer.alloc(22);
icoHeader.writeUInt16LE(0, 0);
icoHeader.writeUInt16LE(1, 2);
icoHeader.writeUInt16LE(1, 4);
icoHeader[6] = 0;
icoHeader[7] = 0;
icoHeader[8] = 0;
icoHeader[9] = 0;
icoHeader.writeUInt16LE(1, 10);
icoHeader.writeUInt16LE(32, 12);
icoHeader.writeUInt32LE(png.length, 14);
icoHeader.writeUInt32LE(22, 18);

const output = path.join(__dirname, '..', 'build');
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, 'icon.png'), png);
fs.writeFileSync(path.join(output, 'icon.ico'), Buffer.concat([icoHeader, png]));
