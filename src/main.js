import '@fontsource-variable/archivo/wdth.css';
import '@fontsource-variable/newsreader/opsz.css';
import '@fontsource-variable/newsreader/opsz-italic.css';
import './style.css';

import manifest from './plates.generated.json';
import { createStage } from './stage/stage.js';
import { initCharts } from './charts.js';
import { initCircle } from './circle.js';
import { initChrome } from './chrome.js';

const root = document.documentElement;

// The moving photographs. If the browser cannot draw them, or the reader asked for
// less motion, the page stays an ordinary article with still images.
let stage = null;
if (root.classList.contains('has-stage')) {
  try {
    stage = createStage(document.getElementById('stage'), manifest, { base: import.meta.env.BASE_URL });
  } catch (err) {
    console.warn('[stage] could not start:', err);
  }
  if (!stage) root.classList.remove('has-stage');
}
window.__stage = stage;

initChrome(stage);
initCharts();
initCircle();
