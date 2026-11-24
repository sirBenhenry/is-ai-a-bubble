// Frame times while scrolling gently inside one section (steady state, textures already loaded).
//   node tools/perf-beat.mjs "#boom" [offset px] [width height]
import puppeteer from 'puppeteer-core';
const [sel = '#top', off = '600', W = '1440', H = '900'] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome-stable', headless: 'new', args: ['--no-sandbox', '--hide-scrollbars', '--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=gl', `--window-size=${W},${H}`] });
const page = await browser.newPage();
await page.setViewport({ width: +W, height: +H, deviceScaleFactor: 1 });
await page.goto(process.env.URL || 'http://127.0.0.1:5173/', { waitUntil: 'networkidle0' });
await page.evaluate((s, o) => scrollTo(0, document.querySelector(s).getBoundingClientRect().top + scrollY + o), sel, +off);
await page.evaluate(() => window.__stage.whenSettled(8000));
const r = await page.evaluate(async () => {
  const y0 = scrollY, times = [];
  let last = performance.now();
  const start = last;
  await new Promise((done) => {
    const tick = (now) => {
      times.push(now - last); last = now;
      const t = (now - start) / 1000;
      scrollTo(0, y0 + Math.sin(t * 1.3) * 380);
      if (t < 6) requestAnimationFrame(tick); else done();
    };
    requestAnimationFrame(tick);
  });
  times.sort((a, b) => a - b);
  const i = window.__stage.info();
  return { frames: times.length, median: +times[times.length >> 1].toFixed(1), p90: +times[Math.floor(times.length * 0.9)].toFixed(1), max: +times.at(-1).toFixed(1), tier: i.tier, ratio: i.ratio, drawn: i.views.filter((v) => v.presence > 0.01).map((v) => v.slug) };
});
console.log(sel, JSON.stringify(r));
await browser.close();
