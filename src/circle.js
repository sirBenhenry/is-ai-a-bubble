// The money circle: three companies, three flows, one valuation in the middle.
// The diagram follows the four steps as they are read.

const NS = 'http://www.w3.org/2000/svg';
const NODES = [
  { name: 'Nvidia', role: 'chipmaker', angle: -90 },
  { name: 'OpenAI', role: 'AI lab', angle: 30 },
  { name: 'Oracle', role: 'cloud', angle: 150 },
];
const VERBS = ['invests', 'rents compute', 'buys chips'];

function el(parent, tag, attrs = {}, text) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  parent.appendChild(node);
  return node;
}

export function initCircle() {
  const host = document.getElementById('circle-svg');
  const steps = [...document.querySelectorAll('.circle__steps li')];
  if (!host || !steps.length) return;

  const C = 320, R = 228;
  const at = (deg, r = R) => [C + r * Math.cos((deg * Math.PI) / 180), C + r * Math.sin((deg * Math.PI) / 180)];
  const root = document.createElementNS(NS, 'svg');
  root.setAttribute('viewBox', '0 0 640 640');
  root.setAttribute('role', 'img');
  root.setAttribute('aria-label', 'Nvidia invests in OpenAI, OpenAI rents compute from Oracle, Oracle buys chips from Nvidia. Each loop adds to the valuation in the middle.');
  host.appendChild(root);

  const core = el(root, 'circle', { class: 'core', cx: C, cy: C, r: 34 });
  const coreLabel = el(root, 'text', { class: 'core-label', x: C, y: C, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, 'Valuation');

  const arcs = [], heads = [], verbs = [];
  NODES.forEach((n, i) => {
    const gap = 26;
    const a0 = n.angle + gap, a1 = n.angle + 120 - gap;
    const [x0, y0] = at(a0), [x1, y1] = at(a1);
    arcs.push(el(root, 'path', { class: 'arc', d: `M${x0} ${y0} A${R} ${R} 0 0 1 ${x1} ${y1}` }));
    const [hx, hy] = at(a1);
    const [bx, by] = at(a1 - 4.4, R + 9);
    const [cx, cy] = at(a1 - 4.4, R - 9);
    heads.push(el(root, 'path', { class: 'head', d: `M${hx} ${hy} L${bx} ${by} L${cx} ${cy} Z` }));
    const mid = n.angle + 60;
    const [vx, vy] = at(mid, R + 30);
    const anchor = Math.abs(((mid + 360) % 360) - 90) < 1 ? 'middle' : Math.cos((mid * Math.PI) / 180) > 0 ? 'start' : 'end';
    verbs.push(el(root, 'text', { class: 'verb', x: vx, y: vy + 6, 'text-anchor': anchor }, VERBS[i]));

    const [nx, ny] = at(n.angle);
    const top = n.angle === -90;
    el(root, 'text', { class: 'name', x: nx, y: ny + (top ? -2 : 16), 'text-anchor': 'middle' }, n.name);
    el(root, 'text', { class: 'role', x: nx, y: ny + (top ? 20 : 38), 'text-anchor': 'middle' }, n.role);
  });

  const narrow = window.matchMedia('(max-width: 820px)');
  let shown = -1;
  function show(step) {
    if (step === shown) return;
    shown = step;
    steps.forEach((li, i) => li.classList.toggle('is-current', i + 1 === step));
    NODES.forEach((_, i) => {
      const on = step >= 4 || i < step;
      arcs[i].classList.toggle('is-on', on);
      heads[i].classList.toggle('is-on', on);
      verbs[i].classList.toggle('is-on', on);
    });
    const r = [34, 44, 58, 76, 104][Math.max(0, Math.min(4, step))];
    core.setAttribute('r', String(r));
    coreLabel.style.fontSize = `${Math.round(Math.max(15, Math.min(34, r * 0.32)))}px`;
  }

  let queued = false;
  const update = () => {
    queued = false;
    const line = window.innerHeight * (narrow.matches ? 0.78 : 0.58);
    let step = 0;
    steps.forEach((li, i) => {
      if (li.getBoundingClientRect().top < line) step = i + 1;
    });
    show(step);
  };
  const request = () => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(update);
    }
  };
  // Without the moving version there is nothing to follow: show the finished diagram.
  if (!document.documentElement.classList.contains('has-stage')) {
    show(4);
    steps.forEach((li) => li.classList.remove('is-current'));
    return;
  }
  window.addEventListener('scroll', request, { passive: true });
  window.addEventListener('resize', request);
  update();
}
