// Contact sheet of images in black and white:  node tools/contact-sheet.mjs out.jpg COLUMNS THUMB_WIDTH file...
import sharp from 'sharp';
import path from 'node:path';
const [out, cols, tw, ...files] = process.argv.slice(2);
const C = +cols, W = +tw, H = Math.round(W * 0.68), gap = 8, lab = 22;
const cells = [];
for (const f of files) {
  try {
    const m = await sharp(f, { limitInputPixels: false }).metadata();
    const img = await sharp(f, { limitInputPixels: false }).rotate().grayscale().resize(W, H, { fit: 'contain', background: '#000' }).toBuffer();
    const name = path.basename(f).replace(/\.[a-z]+$/i, '').slice(0, 46);
    const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${lab}"><rect width="100%" height="100%" fill="#222"/><text x="6" y="15" font-family="sans-serif" font-size="12" fill="#fff">${name} ${m.width}x${m.height}</text></svg>`);
    cells.push({ img, svg });
  } catch (e) { console.log('skip', f, e.message); }
}
const rows = Math.ceil(cells.length / C);
await sharp({ create: { width: C * (W + gap) + gap, height: rows * (H + lab + gap) + gap, channels: 3, background: '#444' } })
  .composite(cells.flatMap((c, i) => { const x = gap + (i % C) * (W + gap), y = gap + Math.floor(i / C) * (H + lab + gap); return [{ input: c.img, left: x, top: y }, { input: c.svg, left: x, top: y + H }]; }))
  .jpeg({ quality: 82 }).toFile(out);
console.log('ok', cells.length);
