// Builds the plates: for every photograph in plates.config.mjs, a black-and-white image
// and a depth map, plus the manifest the page reads.
//
//   npm run plates                 build what is missing or out of date
//   npm run plates -- nyse-1929    build only the named plates
//   npm run plates -- --force      rebuild everything
//   npm run plates -- --local      skip the server step (use depth maps already fetched)
//
// Depth comes from Apple's Depth Pro 2, which runs on a separate machine over SSH
// (see tools/README.md); set PLATES_HOST to its SSH name. `--depth sharp` uses the front
// surface of an Apple SHARP Gaussian-splat scene instead: softer edges, kept for comparison.

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import sharp from 'sharp';

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public/plates');
const WORK = path.join(ROOT, 'build/plates');
const MANIFEST = path.join(ROOT, 'src/plates.generated.json');
// The computer that computes depth: PLATES_HOST, or the ssh name written in .plates-host
// (a one-line file that is not in the repository, because every computer has its own).
let HOST = process.env.PLATES_HOST || '';
if (!HOST) try { HOST = (await fs.readFile(path.join(ROOT, '.plates-host'), 'utf8')).trim(); } catch {}
const REMOTE = 'splat-lab';

const args = process.argv.slice(2);
const force = args.includes('--force');
const localOnly = args.includes('--local');
const useSharp = args[args.indexOf('--depth') + 1] === 'sharp' && args.includes('--depth');
const MODEL = process.env.PLATES_MODEL || 'depthpro2-l';
const MAX_LONG = process.env.PLATES_MAX_LONG || '1536';
const only = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--depth');

const { default: plates } = await import(path.join(ROOT, 'plates.config.mjs'));

// ---- the verified image library (assets-src/*/manifest.json) ----
const library = new Map();
for (const dir of await fs.readdir(path.join(ROOT, 'assets-src')).catch(() => [])) {
  try {
    const m = JSON.parse(await fs.readFile(path.join(ROOT, 'assets-src', dir, 'manifest.json'), 'utf8'));
    for (const item of m.items || []) library.set(`${dir}/${item.slug}`, { ...item, dir });
  } catch {}
}

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}
async function newer(a, b) {
  try { return (await fs.stat(a)).mtimeMs > (await fs.stat(b)).mtimeMs; } catch { return true; }
}

function resolveSource(plate) {
  if (plate.src) return { file: path.resolve(ROOT, plate.src), credit: plate.credit || '', license: plate.license || '', source: plate.source || '' };
  const item = library.get(plate.asset);
  if (!item) throw new Error(`no library image "${plate.asset}"`);
  if (item.verdict && item.verdict !== 'keep') throw new Error(`"${plate.asset}" was rejected at licence check: ${item.reason}`);
  if (!item.verdict) throw new Error(`"${plate.asset}" has not passed the licence check yet`);
  const file = path.isAbsolute(item.file) ? item.file : path.join(ROOT, 'assets-src', item.dir, path.basename(item.file));
  return { file, credit: plate.credit || item.attribution || '', license: item.licenseAsVerified || '', source: item.sourcePage || '' };
}

/** The crop of the source that becomes the plate, as a sharp pipeline. */
async function cropped(file, crop) {
  const meta = await sharp(file, { limitInputPixels: false }).rotate().metadata();
  const W = meta.orientation >= 5 ? meta.height : meta.width;
  const H = meta.orientation >= 5 ? meta.width : meta.height;
  let img = sharp(file, { limitInputPixels: false }).rotate();
  let w = W, h = H;
  if (crop) {
    const left = Math.round((crop.x ?? 0) * W), top = Math.round((crop.y ?? 0) * H);
    w = Math.min(W - left, Math.round((crop.w ?? 1) * W));
    h = Math.min(H - top, Math.round((crop.h ?? 1) * H));
    img = img.extract({ left, top, width: w, height: h });
  }
  return { img, w, h };
}

/** Depth for a soap bubble: a sphere, which no depth model gets right through a transparent film. */
async function sphere(plate, w, h, depthOut) {
  const { cx = 0.5, cy = 0.5, r = 0.45 } = plate.sphere;
  const f = 3 * w;                 // a long lens: nearly parallel rays
  const R = 1;                     // sphere radius, world units
  const rpx = r * Math.min(w, h);
  const zc = (f * R) / rpx;        // distance to the centre that makes it this big in the frame
  const near = zc - R;
  const s = 1024 / Math.max(w, h);
  const dw = Math.round(w * s), dh = Math.round(h * s);
  const bytes = Buffer.alloc(dw * dh);
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const px = ((x + 0.5) / dw - cx) * w, py = ((y + 0.5) / dh - cy) * h;
      const q = 1 - (px * px + py * py) / (rpx * rpx);
      const z = q > 0 ? zc - R * Math.sqrt(q) : 1e6;
      bytes[y * dw + x] = Math.round(255 * Math.min(1, near / z));
    }
  }
  await sharp(bytes, { raw: { width: dw, height: dh, channels: 1 } }).png({ compressionLevel: 9 }).toFile(depthOut);
  // Shift the principal point onto the sphere so the camera orbits the bubble, not the frame.
  return { w, h, f, near, depth: [near, zc, zc + R], sphere: { z: zc, r: R, cx, cy } };
}

/**
 * Cleans a depth map where a depth model is known to go wrong. Options (plates.config.mjs, `depth`):
 *   fillBlack: 12   (reach: 9) Pure black has no depth to speak of, and the model gives it an arbitrary one,
 *                   so a subject on black tears away from its background. Black areas (darker
 *                   than this, 0..255) take the depth of the nearest thing that is not black:
 *                   the cut moves out into the black, where it cannot be seen.
 *   open: 6         Removes near things thinner than about twice this many depth-map pixels
 *                   (wires, lattice, railings). They then move with what is behind them
 *                   instead of breaking into dashes.
 *   smooth: 5       Blurs the depth map. For transparent film, whose depth is noise.
 */
async function cleanDepth(depthFile, photoFile, outFile, opt) {
  const { data, info } = await sharp(depthFile).toColourspace('b-w').raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height;
  let d = new Uint8Array(data);

  if (opt.fillBlack) {
    const lum = await sharp(photoFile).resize(w, h, { fit: 'fill' }).blur(1.2).toColourspace('b-w').raw().toBuffer();
    if (lum.length !== w * h) throw new Error(`cleanDepth: expected one channel, got ${lum.length / (w * h)}`);
    // "Black" reaches a little way into the subject: a bright rim glows past the edge of
    // its own depth silhouette, and depth must be taken from safely inside it.
    const reach = Math.round(opt.reach ?? 9);
    let black = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) black[i] = lum[i] <= opt.fillBlack ? 1 : 0;
    for (const horizontal of [true, false]) {
      const out = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let v = 0;
          for (let k = -reach; k <= reach && !v; k++) {
            const xx = horizontal ? x + k : x, yy = horizontal ? y : y + k;
            if (xx >= 0 && xx < w && yy >= 0 && yy < h) v = black[yy * w + xx];
          }
          out[y * w + x] = v;
        }
      }
      black = out;
    }
    const queue = new Int32Array(w * h);
    const seen = new Uint8Array(w * h);
    let head = 0, tail = 0;
    for (let i = 0; i < w * h; i++) if (!black[i]) { seen[i] = 1; queue[tail++] = i; }
    if (tail > 0 && tail < w * h) {
      // Spread outwards from everything that is not black, each black pixel taking its neighbour's depth.
      while (head < tail) {
        const i = queue[head++], x = i % w, y = (i - x) / w;
        if (x > 0 && !seen[i - 1]) { seen[i - 1] = 1; d[i - 1] = d[i]; queue[tail++] = i - 1; }
        if (x < w - 1 && !seen[i + 1]) { seen[i + 1] = 1; d[i + 1] = d[i]; queue[tail++] = i + 1; }
        if (y > 0 && !seen[i - w]) { seen[i - w] = 1; d[i - w] = d[i]; queue[tail++] = i - w; }
        if (y < h - 1 && !seen[i + w]) { seen[i + w] = 1; d[i + w] = d[i]; queue[tail++] = i + w; }
      }
    }
  }

  if (opt.open) {
    const r = Math.round(opt.open);
    const pass = (src, pick, horizontal) => {
      const out = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let v = src[y * w + x];
          for (let k = -r; k <= r; k++) {
            const xx = horizontal ? Math.min(w - 1, Math.max(0, x + k)) : x;
            const yy = horizontal ? y : Math.min(h - 1, Math.max(0, y + k));
            v = pick(v, src[yy * w + xx]);
          }
          out[y * w + x] = v;
        }
      }
      return out;
    };
    d = pass(pass(d, Math.min, true), Math.min, false);   // thin near things vanish
    d = pass(pass(d, Math.max, true), Math.max, false);   // everything else returns to its size
  }

  let img = sharp(Buffer.from(d), { raw: { width: w, height: h, channels: 1 } });
  if (opt.smooth) img = img.blur(opt.smooth);
  await img.png({ compressionLevel: 9 }).toFile(outFile);
}

await fs.mkdir(OUT, { recursive: true });
await fs.mkdir(path.join(WORK, 'in'), { recursive: true });
await fs.mkdir(path.join(WORK, 'out'), { recursive: true });

const todo = [];
const kept = [];   // plates already built whose originals are not on this computer
for (const plate of plates) {
  if (only.length && !only.includes(plate.slug)) continue;
  try {
    const source = resolveSource(plate);
    if (!(await exists(source.file))) {
      // The originals are not in the repository. A plate that is already built stays as
      // it is; only its caption, alt text and credit follow plates.config.mjs.
      if (!(await exists(path.join(OUT, `${plate.slug}.jpg`)))) throw new Error(`its original is not on this computer (${path.relative(ROOT, source.file)})`);
      kept.push({ plate, source });
      continue;
    }
    todo.push({ plate, source });
  } catch (err) {
    console.warn(`  ${plate.slug}: skipped, ${err.message}`);
  }
}

// 1. Inputs for the depth model: the crop, in its original colours, at up to 3072 px.
const remote = [];
for (const { plate, source } of todo) {
  const input = path.join(WORK, 'in', `${plate.slug}.jpg`);
  plate._stamp = path.join(WORK, 'in', `${plate.slug}.json`);
  const stamp = JSON.stringify({ file: source.file, crop: plate.crop || null, sphere: plate.sphere || null });
  const same = (await exists(plate._stamp)) && (await fs.readFile(plate._stamp, 'utf8')) === stamp;
  const depth = path.join(WORK, 'out', `${plate.slug}.depth.png`);
  if (force || !same || !(await exists(input))) {
    const { img } = await cropped(source.file, plate.crop);
    await img.resize(3072, 3072, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 93 }).toFile(input);
    // The crop changed, so any depth map on disk belongs to a different picture.
    await fs.rm(depth, { force: true });
    await fs.rm(path.join(WORK, 'out', `${plate.slug}.json`), { force: true });
    await fs.rm(plate._stamp, { force: true });
    plate._stampText = stamp;
  }
  if (!plate.sphere && !plate.flat && !(await exists(depth))) remote.push(plate.slug);
  else if (plate._stampText) await fs.writeFile(plate._stamp, plate._stampText);
}

// 2. Depth on the server.
if (remote.length && !localOnly) {
  if (!HOST) throw new Error('No depth machine: set PLATES_HOST or write its ssh name into .plates-host (see tools/README.md).');
  console.log(`depth on ${HOST} (${useSharp ? 'SHARP' : MODEL}) for ${remote.length} plate(s): ${remote.join(', ')}`);
  const ssh = (cmd) => run('ssh', ['-o', 'ConnectTimeout=15', HOST, cmd], { maxBuffer: 1 << 26 });
  await run('rsync', ['-a', path.join(ROOT, 'tools/server') + '/', `${HOST}:${REMOTE}/`]);
  await ssh(`mkdir -p ${REMOTE}/job/in ${REMOTE}/job/ply ${REMOTE}/job/out && rm -f ${REMOTE}/job/in/* ${REMOTE}/job/out/*`);
  await run('rsync', ['-a', ...remote.map((s) => path.join(WORK, 'in', `${s}.jpg`)), `${HOST}:${REMOTE}/job/in/`]);
  const t = Date.now();
  const cmd = useSharp
    ? `venv-sharp/bin/python sharp_cpu.py predict -i job/in -o job/ply -c ckpt/sharp_2572gikvuh.pt --device cpu > job/depth.log 2>&1; ` +
      remote.map((s) => `venv-sharp/bin/python sharp2plate.py job/ply/${s}.ply job/in/${s}.jpg job/out/${s} 2>&1 | tail -1`).join('; ')
    : `venv-dp2/bin/python depthpro2_plate.py ${MODEL} ${MAX_LONG} ${remote.map((s) => `job/in/${s}.jpg job/out/${s}`).join(' ')} 2> job/depth.log`;
  const { stdout } = await ssh(`cd ${REMOTE} && ${cmd}`);
  console.log(stdout.trim().split('\n').map((l) => '  ' + l.slice(0, 170)).join('\n'));
  await run('rsync', ['-a', '--ignore-missing-args', ...remote.flatMap((s) => [`${HOST}:${REMOTE}/job/out/${s}.depth.png`, `${HOST}:${REMOTE}/job/out/${s}.json`]), path.join(WORK, 'out') + '/']);
  console.log(`  ${((Date.now() - t) / 1000).toFixed(0)} s on the server`);
} else if (remote.length) {
  console.warn(`  --local: no depth yet for ${remote.join(', ')}`);
}

// 3. Finish: the photograph in black and white, the depth map, the manifest entry.
let manifest = {};
try { manifest = JSON.parse(await fs.readFile(MANIFEST, 'utf8')); } catch {}

for (const { plate, source } of todo) {
  const photoOut = path.join(OUT, `${plate.slug}.jpg`);
  const depthOut = path.join(OUT, `${plate.slug}.depth.png`);
  const { img, w, h } = await cropped(source.file, plate.crop);
  let info;
  if (plate.flat) {
    info = { w, h, flat: true };   // shown as an ordinary photograph, no depth
  } else if (plate.sphere) {
    info = await sphere(plate, Math.min(w, Math.round((3072 * w) / Math.max(w, h))), Math.min(h, Math.round((3072 * h) / Math.max(w, h))), depthOut);
  } else {
    const d = path.join(WORK, 'out', `${plate.slug}.depth.png`);
    const j = path.join(WORK, 'out', `${plate.slug}.json`);
    if (!(await exists(d)) || !(await exists(j))) {
      console.warn(`  ${plate.slug}: no depth map, skipped`);
      continue;
    }
    if (plate._stampText) await fs.writeFile(plate._stamp, plate._stampText);
    if (plate.depth) await cleanDepth(d, path.join(WORK, 'in', `${plate.slug}.jpg`), depthOut, plate.depth);
    else await fs.copyFile(d, depthOut);
    const m = JSON.parse(await fs.readFile(j, 'utf8'));
    info = { w: m.w, h: m.h, f: m.f, near: m.near, depth: m.depth };
  }

  const tone = plate.tone ?? {};
  const k = Math.min(1, (plate.long ?? 2048) / Math.max(w, h));
  let photo = img.resize(Math.round(w * k), Math.round(h * k), { fit: 'fill', kernel: 'lanczos3' }).grayscale();
  if (tone.normalise !== false) photo = photo.normalise({ lower: tone.lower ?? 0.5, upper: tone.upper ?? 99.5 });
  if (tone.gamma) photo = photo.gamma(tone.gamma);
  if (tone.contrast || tone.lift) {
    const a = tone.contrast ?? 1;
    photo = photo.linear(a, 128 * (1 - a) + (tone.lift ?? 0));
  }
  if (tone.sharpen !== false) photo = photo.sharpen({ sigma: tone.sharpen ?? 0.6 });
  await photo.jpeg({ quality: plate.quality ?? 86, mozjpeg: true }).toFile(photoOut);

  const ps = await fs.stat(photoOut);
  const ds = plate.flat ? { size: 0 } : await fs.stat(depthOut);
  manifest[plate.slug] = {
    ...info,
    photo: `plates/${plate.slug}.jpg`,
    ...(plate.flat ? {} : { depthMap: `plates/${plate.slug}.depth.png` }),
    photoW: Math.round(w * k),
    photoH: Math.round(h * k),
    alt: plate.alt ?? '',
    caption: plate.caption ?? '',
    credit: source.credit,
    license: source.license,
    source: source.source,
  };
  console.log(`  ${plate.slug}: photo ${(ps.size / 1024) | 0} kB, depth ${(ds.size / 1024) | 0} kB`);
}

for (const { plate, source } of kept) {
  if (!manifest[plate.slug]) continue;
  Object.assign(manifest[plate.slug], { alt: plate.alt ?? '', caption: plate.caption ?? '', credit: source.credit, license: source.license, source: source.source });
}
if (kept.length) console.log(`  ${kept.length} photograph(s) kept as built: their originals are not on this computer, so only their text was updated`);

const wanted = new Set(plates.map((p) => p.slug));
for (const slug of Object.keys(manifest)) if (!wanted.has(slug)) delete manifest[slug];
await fs.writeFile(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
console.log(`wrote ${path.relative(ROOT, MANIFEST)} (${Object.keys(manifest).length} plates)`);

// 4. Keep index.html in step: each figure's image, alt text and caption, and the list of
//    photographs with credits and licences, all come from this config and the manifests.
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attr = (t) => esc(t).replace(/"/g, '&quot;');
const DEED = { 'BY': 'by', 'BY-SA': 'by-sa' };

function creditLine(m) {
  // The licence checker's attribution, tidied: bare URLs and per-image change notes go
  // (one note above the list covers every picture), and the licence name becomes a link.
  let text = esc(m.credit || '')
    .replace(/\s*\(https?:\/\/[^)\s]+\)/g, '')
    .replace(/[,;.]?\s*\(?converted to (gr[ae]yscale|black and white)\)?\.?/gi, '')
    .replace(/\s+([.,])/g, '$1')
    .trim()
    .replace(/[.,;]$/, '');
  const lic = m.license || '';
  let licence = '';
  const cc = /CC[ -](BY-SA|BY)[ -](\d\.\d)/i.exec(lic);
  const zero = /CC0/i.test(lic);
  if (cc || zero) {
    const name = zero && !cc ? 'CC0 1.0' : `CC ${cc[1].toUpperCase()} ${cc[2]}`;
    const url = zero && !cc ? 'https://creativecommons.org/publicdomain/zero/1.0/' : `https://creativecommons.org/licenses/${DEED[cc[1].toUpperCase()]}/${cc[2]}/`;
    const link = `<a href="${url}" rel="license">${name}</a>`;
    const plain = new RegExp(name.replace(/[ -]/g, '[ -]').replace('.', '\\.'), 'i');
    if (plain.test(text)) text = text.replace(plain, link);
    else licence = ` ${link}.`;
    if (cc && cc[1].toUpperCase() === 'BY-SA') licence += ' Our version is shared under the same licence.';
  } else if (/unrestricted/i.test(lic) && /National Archives/i.test(lic)) {
    licence = ' Use unrestricted (U.S. National Archives).';
  } else if (/public domain|\bPD-/i.test(lic)) {
    // The record says how the check was made; the page only needs the result. Old works are
    // out of copyright everywhere; for the others the check covered the United States.
    const usOnly = /\bUS\b|United States/.test(lic) && !/PD-old|PD-Art/.test(lic);
    if (!/public domain/i.test(text)) licence = usOnly ? ' Public domain in the United States.' : ' Public domain.';
  } else if (lic && !text.toLowerCase().includes(lic.toLowerCase().slice(0, 14))) {
    licence = ` ${esc(lic.split(/(?<=\.)\s/)[0]).replace(/\.$/, '')}.`;
  }
  const title = esc(m.caption || '').replace(/\.$/, '');
  const source = m.source ? ` <a href="${attr(m.source)}">Source<span class="sr-only">: ${title}</span></a>.` : '';
  const stop = /[\w\d]$/.test(title) ? '.' : '';
  return `<li><b>${title}${stop}</b> ${text}.${licence}${source}</li>`;
}

const PAGE = path.join(ROOT, 'index.html');
let page = await fs.readFile(PAGE, 'utf8');
const before = page;
const used = [];
page = page.replace(/(<figure class="(?:plate|photo)[^"]*"(?: data-plate="([^"]+)")?[^>]*>)([\s\S]*?)(<\/figure>)/g, (all, open, slug, inner, close) => {
  const key = slug || (/src="plates\/([^"./]+)\.jpg"/.exec(inner) || [])[1];
  const m = manifest[key];
  if (!m) return all;
  if (!used.includes(key)) used.push(key);
  const img = `<img src="${m.photo}" width="${m.photoW}" height="${m.photoH}" alt="${attr(m.alt)}" loading="lazy" decoding="async">`;
  const cap = m.caption ? `<figcaption>${esc(m.caption)}</figcaption>` : '';
  return `${open}${img}${cap}${close}`;
});
page = page.replace(/(<ul class="credits">)[\s\S]*?(<\/ul>)/, (all, open, close) => `${open}\n          ${used.map((k) => creditLine(manifest[k])).join('\n          ')}\n        ${close}`);
if (page !== before) {
  await fs.writeFile(PAGE, page);
  console.log(`updated index.html: ${used.length} photographs, their captions and credits`);
}
const unused = Object.keys(manifest).filter((k) => !used.includes(k));
if (unused.length) console.warn(`  not used on the page (remove from plates.config.mjs or place them): ${unused.join(', ')}`);
