// Screenshots of the page at chosen scroll positions, using the installed Chrome.
//
//   node tools/shoot.mjs --url http://localhost:5173/ --out shots --at 0,900,1800
//   node tools/shoot.mjs --frames 24            24 evenly spaced positions down the whole page
//   node tools/shoot.mjs --every 700            one shot every 700 px
//   node tools/shoot.mjs --sel "#history"       scroll that element to the top
//   --size 1440x900   --mobile   --sheet (contact sheet)   --wait 500 (ms after settling)
//   --perf            scroll the whole page and report frame times

import fs from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
};

const url = arg('url', 'http://localhost:5173/');
const out = path.resolve(arg('out', 'shots'));
const [W, H] = String(arg('size', '1440x900')).split('x').map(Number);
const mobile = !!arg('mobile', false);
const wait = Number(arg('wait', 350));
const prefix = arg('name', mobile ? 'm' : 'd');
const sheet = !!arg('sheet', false);
const perf = !!arg('perf', false);
const reduced = !!arg('reduced', false);

await fs.mkdir(out, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: arg('chrome', process.env.CHROME || '/usr/bin/google-chrome-stable'),
  headless: 'new',
  args: ['--no-sandbox', '--hide-scrollbars', '--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=gl', '--enable-unsafe-swiftshader', `--window-size=${W},${H}`],
});
const page = await browser.newPage();
await page.setViewport(mobile ? { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { width: W, height: H, deviceScaleFactor: 1 });
if (reduced) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);

const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warn') errors.push(`${m.type()}: ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()}`));

await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
await page.evaluate(() => document.fonts.ready);

const settle = async () => {
  await page.evaluate(() => (window.__stage ? window.__stage.whenSettled(5000) : new Promise((r) => setTimeout(r, 300))));
  await new Promise((r) => setTimeout(r, wait));
};

const total = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
let positions = [];
if (arg('at')) positions = String(arg('at')).split(',').map(Number);
else if (arg('frames')) {
  const n = Number(arg('frames'));
  positions = Array.from({ length: n }, (_, i) => Math.round((total * i) / Math.max(1, n - 1)));
}
else if (arg('every')) for (let y = 0; y <= total; y += Number(arg('every'))) positions.push(y);
else if (arg('sel')) {
  for (const sel of String(arg('sel')).split(',')) {
    const y = await page.evaluate((s) => {
      const el = document.querySelector(s);
      return el ? Math.round(el.getBoundingClientRect().top + window.scrollY) : -1;
    }, sel);
    if (y >= 0) positions.push(y + Number(arg('offset', 0)));
  }
} else positions = [0];

if (perf) {
  const result = await page.evaluate(async () => {
    const total = document.documentElement.scrollHeight - innerHeight;
    const times = [];
    let last = performance.now();
    const start = last;
    const duration = 12000;
    await new Promise((done) => {
      const tick = (now) => {
        times.push(now - last);
        last = now;
        const t = (now - start) / duration;
        scrollTo(0, total * Math.min(1, t));
        if (t < 1) requestAnimationFrame(tick);
        else done();
      };
      requestAnimationFrame(tick);
    });
    times.sort((a, b) => a - b);
    return {
      frames: times.length,
      median: +times[times.length >> 1].toFixed(1),
      p95: +times[Math.floor(times.length * 0.95)].toFixed(1),
      max: +times[times.length - 1].toFixed(1),
      stage: window.__stage ? window.__stage.info() : null,
    };
  });
  console.log(JSON.stringify(result, null, 1));
} else {
  const files = [];
  for (const [i, y] of positions.entries()) {
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await settle();
    const file = path.join(out, `${prefix}-${String(i).padStart(2, '0')}-${y}.png`);
    await page.screenshot({ path: file });
    files.push(file);
  }
  console.log(`${files.length} shots in ${out} (page scroll length ${total}px)`);
  const info = await page.evaluate(() => (window.__stage ? window.__stage.info() : null));
  if (info) console.log(`stage: tier ${info.tier}, ratio ${info.ratio}, canvas ${info.canvas.join('x')}, ${info.renderer}`);

  if (sheet && files.length > 1) {
    const cols = Number(arg('cols', mobile ? 6 : 3));
    const tw = Number(arg('thumb', mobile ? 260 : 640));
    const meta = await sharp(files[0]).metadata();
    const th = Math.round((tw * meta.height) / meta.width);
    const rows = Math.ceil(files.length / cols);
    const gap = 6;
    const thumbs = await Promise.all(files.map((f) => sharp(f).resize(tw, th).toBuffer()));
    const file = path.join(out, `${prefix}-sheet.jpg`);
    await sharp({ create: { width: cols * (tw + gap) + gap, height: rows * (th + gap) + gap, channels: 3, background: '#3a3a3a' } })
      .composite(thumbs.map((input, i) => ({ input, left: gap + (i % cols) * (tw + gap), top: gap + Math.floor(i / cols) * (th + gap) })))
      .jpeg({ quality: 82 })
      .toFile(file);
    console.log(`sheet: ${file}`);
  }
}

if (errors.length) console.log('page messages:\n  ' + [...new Set(errors)].slice(0, 20).join('\n  '));
await browser.close();
