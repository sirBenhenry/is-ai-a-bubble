// The two charts. Both are plain SVG in black and white. The data sits at the top of this
// file so it can be replaced with sourced series.

// Nvidia market value: [label, months since October 2022, US$ trillion].
// Approximate milestones: the first close above each mark.
const NVIDIA = [
  ['Oct 2022', 0, 0.36],
  ['May 2023', 7, 1],
  ['Feb 2024', 16, 2],
  ['Jun 2024', 20, 3],
  ['Jul 2025', 33, 4],
  ['Oct 2025', 36, 5],
];

// Comparison of bubbles: illustrative curves, not sourced data.
// x = months from the peak, y = index (peak = 100).
const curve = (s, k, tau, end) => {
  const pts = [];
  for (let m = -36; m <= end; m += 1) {
    const v = m <= 0
      ? 100 * (s + (1 - s) * Math.sin((Math.PI / 2) * Math.pow((m + 36) / 36, k)))
      : 100 * Math.exp(-Math.pow(m / tau, 1.4)) + 8 * (1 - Math.exp(-m / tau));
    pts.push([m, v]);
  }
  return pts;
};
const BUBBLES = [
  { label: '1929', points: curve(0.25, 2.2, 7, 24), dash: '2 5' },
  { label: 'Dot-com', points: curve(0.2, 1.8, 14, 24), dash: '9 5' },
  { label: 'Housing', points: curve(0.45, 1.2, 24, 24), dash: '' },
  { label: 'AI today', points: curve(0.1, 2.1, 1, -6), main: true },
];

const NS = 'http://www.w3.org/2000/svg';
const narrowScreen = window.matchMedia('(max-width: 820px)');

function el(parent, tag, attrs = {}, text) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  parent.appendChild(node);
  return node;
}

function svg(host, w, h, label) {
  const root = document.createElementNS(NS, 'svg');
  root.setAttribute('viewBox', `0 0 ${w} ${h}`);
  root.setAttribute('role', 'img');
  root.setAttribute('aria-label', label);
  host.appendChild(root);
  return root;
}

/** The same numbers as a table, for people who cannot see the drawing. */
function table(host, caption, head, rows) {
  const t = document.createElement('table');
  t.className = 'sr-only';
  t.innerHTML = `<caption>${caption}</caption><thead><tr>${head.map((h) => `<th scope="col">${h}</th>`).join('')}</tr></thead>` +
    `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>`;
  host.appendChild(t);
}

/** Draws each line in as the chart scrolls up through the viewport. Returns a function that stops it. */
function drawOnScroll(host, lines, after = []) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const lengths = lines.map((l) => l.getTotalLength());
  lines.forEach((l, i) => {
    if (!l.dataset.dash) l.style.strokeDasharray = `${lengths[i]}`;
  });
  let queued = false;
  const update = () => {
    queued = false;
    const r = host.getBoundingClientRect();
    const vh = window.innerHeight;
    const p = reduced ? 1 : Math.min(1, Math.max(0, (vh * 0.92 - r.top) / (vh * 0.62)));
    lines.forEach((l, i) => {
      if (l.dataset.dash) l.style.opacity = String(Math.min(1, p * 1.4));
      else l.style.strokeDashoffset = String(lengths[i] * (1 - p));
    });
    after.forEach(({ node, at }) => {
      node.style.opacity = String(Math.min(1, Math.max(0, (p - at) / 0.08)));
    });
  };
  const request = () => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(update);
    }
  };
  window.addEventListener('scroll', request, { passive: true });
  window.addEventListener('resize', request);
  update();
  return () => {
    window.removeEventListener('scroll', request);
    window.removeEventListener('resize', request);
  };
}

// On a phone the drawing is about 350 px wide, so it is laid out in a smaller coordinate
// space with larger type: labels come out near 12 px either way.
function nvidia(host, narrow) {
  const W = narrow ? 640 : 1200, H = narrow ? 600 : 560;
  const L = narrow ? 44 : 44, R = narrow ? 104 : 150, T = 28, B = narrow ? 58 : 44;
  const fs = narrow ? 22 : 14, fsAxis = narrow ? 21 : 13;
  const x = (m) => L + (m / 36) * (W - L - R);
  const y = (v) => H - B - (v / 5.4) * (H - T - B);
  const root = svg(host, W, H, 'Line chart: Nvidia market value rising from about 0.36 trillion dollars in October 2022 to 5 trillion in October 2025. The values are in the table that follows.');

  for (let v = 0; v <= 5; v++) {
    el(root, 'line', { class: 'grid', x1: L, x2: W - R, y1: y(v), y2: y(v) });
    el(root, 'text', { class: 'axis', x: L - 10, y: y(v) + fsAxis * 0.33, 'text-anchor': 'end', 'font-size': fsAxis }, String(v));
  }
  [['2023', 3], ['2024', 15], ['2025', 27]].forEach(([year, m]) => {
    el(root, 'line', { class: 'grid', x1: x(m), x2: x(m), y1: H - B, y2: H - B + 7 });
    el(root, 'text', { class: 'axis', x: x(m) + 7, y: H - B + fsAxis * 1.7, 'font-size': fsAxis }, year);
  });

  const d = NVIDIA.map(([, m, v], i) => `${i ? 'L' : 'M'}${x(m).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const line = el(root, 'path', { class: 'line', d });
  const after = [];
  NVIDIA.forEach(([label, m, v], i) => {
    const g = el(root, 'g');
    el(g, 'circle', { class: 'dot', cx: x(m), cy: y(v), r: narrow ? 6 : 4.5 });
    const first = i === 0, last = i === NVIDIA.length - 1;
    const tx = x(m) + (first && !narrow ? 0 : fs * (first ? 0.8 : 1));
    const ty = y(v) + (first ? (narrow ? fs * 1.15 : -fs * 2.2) : last ? fs * 0.35 : fs * 1.55);
    el(g, 'text', { class: 'label', x: tx, y: ty, 'font-size': fs }, v < 1 ? '$0.36T' : `$${v}T`);
    // Dates beside every point only where there is room for them.
    if (!narrow) el(g, 'text', { class: 'label label--quiet', x: tx, y: ty + fs * 1.3, 'font-size': fs }, label);
    after.push({ node: g, at: Math.max(0, m / 36 - 0.04) });
    g.style.opacity = '0';
  });
  table(host, 'Nvidia market value, approximate milestones', ['Date', 'Market value, US$ trillion'], NVIDIA.map(([label, , v]) => [label, v]));
  return drawOnScroll(host, [line], after);
}

function compare(host, narrow) {
  const W = narrow ? 640 : 1200, H = narrow ? 620 : 600;
  const L = narrow ? 52 : 44, R = narrow ? 128 : 120, T = 30, B = narrow ? 62 : 48;
  const fs = narrow ? 22 : 14, fsAxis = narrow ? 21 : 13;
  const x = (m) => L + ((m + 36) / 60) * (W - L - R);
  const y = (v) => H - B - (v / 108) * (H - T - B);
  const root = svg(host, W, H, 'Line chart, illustrative: indexed prices of the 1929, dot-com and housing bubbles from three years before their peaks to two years after. Each climbs to 100 at its peak and then falls: 1929 fastest, housing slowest. AI today follows the same climb and stops six months short of a peak.');

  [0, 25, 50, 75, 100].forEach((v) => {
    el(root, 'line', { class: 'grid', x1: L, x2: W - R, y1: y(v), y2: y(v) });
    el(root, 'text', { class: 'axis', x: L - 10, y: y(v) + fsAxis * 0.33, 'text-anchor': 'end', 'font-size': fsAxis }, String(v));
  });
  (narrow ? [-36, -12, 0, 24] : [-36, -24, -12, 0, 12, 24]).forEach((m) => {
    el(root, 'text', { class: 'axis', x: x(m), y: H - B + fsAxis * 1.7, 'text-anchor': 'middle', 'font-size': fsAxis }, m === 0 ? 'Peak' : `${m > 0 ? '+' : '−'}${Math.abs(m)}`);
  });
  el(root, 'line', { class: 'mark', x1: x(0), x2: x(0), y1: T - 10, y2: H - B });
  el(root, 'text', { class: 'axis', x: W - R, y: H - 4, 'text-anchor': 'end', 'font-size': fsAxis }, 'months');

  const lines = [];
  const after = [];
  BUBBLES.forEach((s) => {
    const d = s.points.map(([m, v], i) => `${i ? 'L' : 'M'}${x(m).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
    const path = el(root, 'path', { class: s.main ? 'line' : 'line line--quiet', d });
    if (s.dash) {
      path.setAttribute('stroke-dasharray', s.dash);
      path.dataset.dash = '1';
    }
    lines.push(path);
    const [m, v] = s.points[s.points.length - 1];
    const label = el(root, 'text', { class: s.main ? 'label' : 'label label--quiet', x: x(m) + 12, y: y(v) + (s.main ? -fs * 0.85 : fs * 0.35), 'font-size': fs }, s.label);
    if (s.main) after.push({ node: el(root, 'circle', { class: 'dot', cx: x(m), cy: y(v), r: narrow ? 7 : 5 }), at: 0.9 });
    after.push({ node: label, at: 0.9 });
  });
  return drawOnScroll(host, lines, after);
}

export function initCharts() {
  const charts = [
    [document.querySelector('#chart-nvidia .chart__plot'), nvidia],
    [document.querySelector('#chart-compare .chart__plot'), compare],
  ].filter(([host]) => host);
  let stop = [];
  const build = () => {
    stop.forEach((fn) => fn());
    stop = charts.map(([host, draw]) => {
      host.textContent = '';
      return draw(host, narrowScreen.matches);
    });
  };
  build();
  narrowScreen.addEventListener('change', build);
}
