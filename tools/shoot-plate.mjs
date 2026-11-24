// The start and the end of one photograph's camera move, side by side.
//   node tools/shoot-plate.mjs keynote aisle pylons     (plate names as used in data-plate)
//   SIZE=1920x1080 node tools/shoot-plate.mjs keynote   (window size; default 1440x900)
//   FULL=1 node tools/shoot-plate.mjs keynote           (also keeps both frames at full size, for a close look)
import path from 'node:path';
import fs from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
const slugs = process.argv.slice(2);
const [W, H] = (process.env.SIZE || '1440x900').split('x').map(Number);
const out = path.resolve('shots/plates');
await fs.mkdir(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome-stable', headless: 'new', args: ['--no-sandbox', '--hide-scrollbars', '--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=gl', `--window-size=${W},${H}`] });
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
await page.goto(process.env.URL || 'http://127.0.0.1:5173/', { waitUntil: 'networkidle0' });
await page.evaluate(() => document.fonts.ready);
for (const slug of slugs) {
  const range = await page.evaluate((s) => {
    const fig = document.querySelector(`figure[data-plate="${s}"]`);
    if (!fig) return null;
    const beat = fig.closest('[data-beat]');
    const top = beat.getBoundingClientRect().top + scrollY;
    return [top, Math.max(0, beat.offsetHeight - innerHeight)];
  }, slug);
  if (!range) { console.log(slug, 'not on the page'); continue; }
  const shots = [];
  for (const f of [0.04, 0.96]) {
    await page.evaluate((y) => scrollTo(0, y), range[0] + range[1] * f);
    await page.evaluate(() => window.__stage && window.__stage.whenSettled(6000));
    await new Promise((r) => setTimeout(r, 500));
    shots.push(await page.screenshot());
  }
  if (process.env.FULL) {
    await fs.writeFile(path.join(out, `${slug}.start.png`), shots[0]);
    await fs.writeFile(path.join(out, `${slug}.end.png`), shots[1]);
  }
  const [a, b] = await Promise.all(shots.map((s) => sharp(s).resize(960).toBuffer()));
  const h = (await sharp(a).metadata()).height;
  const file = path.join(out, `${slug}.jpg`);
  await sharp({ create: { width: 1928, height: h, channels: 3, background: '#444' } }).composite([{ input: a, left: 0, top: 0 }, { input: b, left: 968, top: 0 }]).jpeg({ quality: 86 }).toFile(file);
  console.log(slug, file);
}
console.log('tier', await page.evaluate(() => window.__stage && window.__stage.info().tier));
await browser.close();
