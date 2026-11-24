// Page furniture: the corner labels, the chapter index they open, and the moment of the pop.

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const ease = (t) => t * t * (3 - 2 * t);

export function initChrome(stage) {
  const masthead = document.querySelector('.masthead');
  const toggle = document.querySelector('.masthead__toggle');
  const links = [...document.querySelectorAll('.index ol a')];
  const here = document.querySelector('.masthead__here');
  const chapters = links.map((a) => document.querySelector(a.getAttribute('href'))).filter(Boolean);
  const paper = document.querySelector('.paper');

  // The chapter index covers the whole screen. While it is open the page behind it is out
  // of reach, so focus cannot wander into text that the index covers.
  const main = document.querySelector('main');
  const setOpen = (open) => {
    masthead.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.textContent = open ? 'Close' : 'Chapters';
    if (main) main.inert = open;
  };
  const close = () => setOpen(false);
  toggle?.setAttribute('aria-label', 'Chapters');
  toggle?.addEventListener('click', () => setOpen(!masthead.classList.contains('is-open')));
  document.querySelectorAll('.index a').forEach((a) => a.addEventListener('click', close));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && masthead.classList.contains('is-open')) {
      close();
      toggle.focus();
    }
  });

  // The pop: the verdict appears as the film goes.
  const burst = document.getElementById('burst');
  const before = document.querySelector('.pop__before');
  const verdict = document.querySelector('.pop__verdict');
  let moving = document.documentElement.classList.contains('has-stage');
  let lastY = window.scrollY;

  let queued = false;
  function update() {
    queued = false;
    const vh = window.innerHeight;
    const line = vh * 0.4;

    // Which chapter is being read.
    let current = -1;
    chapters.forEach((el, i) => {
      if (el.getBoundingClientRect().top <= line) current = i;
    });
    const onPaper = paper ? paper.getBoundingClientRect().top <= 40 : false;
    links.forEach((a, i) => {
      if (i === current && !onPaper) a.setAttribute('aria-current', 'location');
      else a.removeAttribute('aria-current');
    });
    // The corner label says where the reader is: "3 Financing".
    const label = current >= 0 && !onPaper ? `${current + 1} ${links[current].dataset.short}` : '';
    if (here && here.textContent !== label) here.textContent = label;
    masthead.classList.toggle('is-inverted', onPaper);

    // On a phone the corner labels step aside while the reader moves down the page and
    // return on the way up (the style sheet only acts on this class at phone width).
    const y = window.scrollY;
    if (y < vh * 0.6 || y < lastY - 6) masthead.classList.remove('is-hidden');
    else if (y > lastY + 6) masthead.classList.add('is-hidden');
    lastY = y;

    if (burst && verdict && moving) {
      const r = burst.getBoundingClientRect();
      const p = clamp((vh * 0.5 - r.top) / Math.max(1, r.height));
      verdict.style.opacity = ease(clamp((p - 0.3) / 0.4)).toFixed(3);
      if (before) before.style.opacity = (1 - ease(clamp(p / 0.25))).toFixed(3);
    }
  }
  const request = () => {
    if (!queued) {
      queued = true;
      requestAnimationFrame(update);
    }
  };
  window.addEventListener('scroll', request, { passive: true });
  window.addEventListener('resize', request);
  // If the moving photographs switch off mid-visit, nothing may stay hidden behind them.
  document.addEventListener('stage:off', () => {
    moving = false;
    if (verdict) verdict.style.opacity = '';
    if (before) before.style.opacity = '';
  });
  update();
  void stage;
}
