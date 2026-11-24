// The photographs the page uses, and how each is cut.
//
// `asset` names an image in assets-src/<folder>/ that passed the licence check recorded in
// that folder's manifest.json; its credit line and licence are taken from there.
// `crop` is in fractions of the source (x, y, w, h). `caption` is shown beside the plate.
// Run `npm run plates` after changing this file.
//
// What makes a photograph work in 3D: things in front of other things, from near to far
// (an aisle, a street canyon, a crowd). Distant subjects on a flat backdrop only shear.
//
// `depth` cleans the depth map where the model is known to fail: subjects on pure black
// (fillBlack), wires and lattice (open), transparent film (smooth). See tools/make-plates.mjs.

export default [
  // ---- the bubble ----
  {
    slug: 'bubble',
    asset: 'bubble/soap-bubble-sphere-swirls-olah',
    sphere: { cx: 0.3091, cy: 0.5167, r: 0.4235 },
    tone: { normalise: false, gamma: 1.0, contrast: 1.08 },
    caption: 'A bubble of soap film, half lit. The marbling is the film draining. (The photographer mixed oil into the soap.)',
    alt: 'A bubble lit from the right against black, its surface marbled with swirling bands.',
  },
  {
    slug: 'film',
    asset: 'bubble/soap-film-lipid-islands-gaff',
    caption: 'Soap film under a microscope: islands of thicker film in a thinning sheet.',
    alt: 'Round islands with concentric rings floating in a dark soap film.',
  },
  {
    slug: 'marbling',
    asset: 'bubble/soap-bubble-closeup-marbling-olah',
    depth: { fillBlack: 12, smooth: 9 },   // transparent film on black: see cleanDepth in tools/make-plates.mjs
    caption: 'The surface of a bubble, close.',
    alt: 'Close view of a soap bubble whose surface is covered in fine swirling bands.',
  },
  {
    slug: 'froth',
    asset: 'bubble/foam-cluster-black-rabich',
    depth: { fillBlack: 10, reach: 2, smooth: 10 },   // see-through bubbles: their dark insides take the depth of their walls
    crop: { x: 0.12, y: 0, w: 0.8, h: 1 },
    caption: 'Froth: a cluster of bubbles sharing their walls.',
    alt: 'A dome-shaped cluster of soap bubbles against black, each outlined by thin bright walls.',
  },
  {
    slug: 'black-film',
    asset: 'bubble/soap-bubble-top-black-film-braxton',
    crop: { x: 0, y: 0, w: 1, h: 0.84 },
    caption: 'Dark patches at the top of a bubble, where the film has thinned so far that it looks black. A film this thin is close to bursting.',
    alt: 'The top of a soap bubble mottled with black patches where the film has thinned.',
  },
  {
    slug: 'thinning',
    asset: 'bubble/soap-film-black-film-klepnev',
    caption: 'Black film spreading through a soap film.',
    alt: 'A large dark area of very thin soap film dotted with pale discs, meeting bright banded film along a sharp curved edge.',
  },

  // ---- 1637, 1720 ----
  {
    slug: 'tulip-satire',
    depth: { smooth: 4 },                  // a painting: brush strokes make ragged depth edges
    asset: 'early-manias/brueghel-satire-on-tulip-mania',
    caption: 'Jan Brueghel the Younger, Allegory of Tulip Mania, about 1640 to 1650. The speculators are painted as monkeys.',
    alt: 'A painting of monkeys in human dress trading, weighing and counting tulips in an arcade.',
  },
  {
    slug: 'tulip-book',
    asset: 'early-manias/leyster-tulip-book-broken-tulip-1643',
    caption: 'A flamed tulip from a Dutch tulip book of about 1643, artist unknown. Growers showed buyers pictures like this one.',
    alt: 'A watercolour of a single tulip with flame-like stripes on its petals.',
  },
  {
    slug: 'change-alley',
    asset: 'early-manias/ward-south-sea-bubble-change-alley-engraving',
    caption: 'Exchange Alley in 1720, as the Victorian painter Edward Matthew Ward imagined it in 1847 (engraving).',
    alt: 'An engraving of a crowded London alley full of people buying and selling shares.',
  },

  // ---- 1929 ----
  {
    slug: 'nyse-1929',
    asset: 'crash-1929/nyse-crowd-after-crash-1929',
    crop: { x: 0.04, y: 0.07, w: 0.91, h: 0.86 },
    caption: 'The crowd outside the New York Stock Exchange after the crash, 1929.',
    alt: 'A dense crowd of men in hats filling the street in front of the New York Stock Exchange.',
  },
  {
    slug: 'broad-street',
    asset: 'crash-1929/broad-street-toward-wall-street-abbott-1936',
    crop: { x: 0, y: 0.28, w: 1, h: 0.72 },
    caption: 'Broad Street looking toward Wall Street, photographed by Berenice Abbott in 1936.',
    alt: 'A narrow street between tall office buildings in lower Manhattan, cars parked along the kerb.',
  },
  {
    slug: 'bank-run',
    asset: 'crash-1929/american-union-bank-run-1932',
    caption: 'Depositors in front of the closed American Union Bank, New York, 1932.',
    alt: 'A crowd pressed around the entrance of a bank, seen from above.',
  },
  {
    slug: 'soup-queue',
    asset: 'crash-1929/soup-kitchen-queue-chicago-1931',
    crop: { x: 0, y: 0, w: 0.99, h: 0.985 },
    caption: 'Unemployed men queue outside a soup kitchen, Chicago, 1931.',
    alt: 'A long line of men in coats and caps waiting under a sign offering free soup, coffee and doughnuts.',
  },
  {
    slug: 'front-page',
    asset: 'crash-1929/santa-ana-register-front-page-1929-10-28',
    // Masthead and banner only: the rest of the page carries an unrelated court story with
    // the portrait and name of a 17-year-old witness, which must stay out.
    crop: { x: 0, y: 0, w: 1, h: 0.155 },
    caption: 'The Santa Ana Register, 28 October 1929.',
    alt: 'A newspaper front page with the banner headline “Billions lost as stocks crash”.',
  },
  {
    slug: 'ticker',
    asset: 'crash-1929/nyse-ticker-central-control-station-1922',
    crop: { x: 0.01, y: 0.015, w: 0.98, h: 0.965 },
    caption: 'The central control station of the stock ticker, New York Stock Exchange, 1922.',
    alt: 'A long bench of ticker instruments under glass domes in a tall room.',
  },

  // ---- 2000, 2008 ----
  {
    slug: 'times-square-2000',
    asset: 'dotcom-housing/times-square-new-years-eve-2000',
    caption: 'Times Square on New Year’s Eve, 1999 to 2000.',
    alt: 'A crowd filling Times Square at night under lit advertising signs.',
  },
  {
    slug: 'foreclosure',
    depth: { open: 5 },                    // palm fronds in the corner move with the tree behind them
    asset: 'dotcom-housing/foreclosure-sign-2008',
    caption: 'A foreclosure sign in front of a house, 2008.',
    alt: 'A real-estate sign reading “Foreclosure” fixed in front of a house.',
  },

  // ---- the AI boom ----
  {
    slug: 'keynote',
    asset: 'ai-people-markets/ces-2025-nvidia-keynote-arena',
    caption: 'The audience at Nvidia’s keynote, CES, Las Vegas, January 2025.',
    alt: 'A packed arena seen from the upper tier, thousands of people facing a huge lit screen.',
  },
  {
    slug: 'wafer',
    asset: 'ai-hardware/intel-processor-wafer-black',
    depth: { fillBlack: 12, smooth: 12 },
    caption: 'A silicon wafer of processors before it is cut into chips.',
    alt: 'A round silicon wafer covered in a grid of identical chips, on black.',
  },
  {
    slug: 'chip',
    asset: 'ai-hardware/nvidia-ga102-gpu-chip-macro',
    caption: 'An Nvidia graphics processor for gaming (GeForce RTX 3090, 2020) on its circuit board.',
    alt: 'Close view of a square Nvidia chip seated on a circuit board.',
  },
  {
    slug: 'oracle',
    asset: 'ai-people-markets/oracle-headquarters-redwood-shores',
    crop: { x: 0, y: 0.05, w: 1, h: 0.82 },
    caption: 'Oracle’s former headquarters, Redwood Shores, California.',
    alt: 'A row of cylindrical glass office towers beside a lake.',
  },
  {
    slug: 'aisle',
    asset: 'ai-hardware/frontier-supercomputer-aisle',
    caption: 'Frontier, a supercomputer built for science at Oak Ridge National Laboratory, 2022.',
    alt: 'A long, brightly lit aisle between two rows of tall black computer cabinets.',
  },
  {
    slug: 'summit',
    asset: 'ai-hardware/summit-supercomputer-row',
    caption: 'The Summit supercomputer, Oak Ridge National Laboratory, 2018. It was switched off in 2024.',
    alt: 'A row of computer cabinets with angular panels receding into the distance.',
  },
  {
    slug: 'racks',
    asset: 'ai-hardware/server-racks-dark-aisle',
    caption: 'Server racks in a data centre.',
    alt: 'Dark server racks with perforated doors, seen at an angle along an aisle.',
  },
  {
    slug: 'pylons',
    asset: 'ai-hardware/power-lines-corridor-bw',
    depth: { open: 9, smooth: 2.5 },       // wires and lattice move with the sky behind them
    caption: 'A power-line corridor.',
    alt: 'Electricity pylons marching away down a cleared strip between trees.',
  },
  {
    slug: 'power-station',
    asset: 'ai-hardware/rostock-power-station-night',
    caption: 'Rostock coal power station, Germany, 2021.',
    alt: 'A power station at night, steam rising from its cooling tower past bright lamps.',
  },

  // ---- markets today ----
  {
    slug: 'trading-floor',
    asset: 'ai-people-markets/nyse-trading-floor-2021',
    crop: { x: 0.37, y: 0, w: 0.63, h: 1 },
    caption: 'The trading floor of the New York Stock Exchange, November 2021.',
    alt: 'Trading posts and overhead screens on the floor of the New York Stock Exchange.',
  },
  {
    slug: 'nyse-facade',
    asset: 'ai-people-markets/nyse-facade-wide-angle-2021',
    crop: { x: 0, y: 0, w: 1, h: 0.9 },
    caption: 'The New York Stock Exchange, Broad Street.',
    alt: 'The columned front of the New York Stock Exchange seen from below, towers rising behind it.',
  },
  {
    slug: 'wall-street',
    asset: 'ai-people-markets/wall-street-sign-canyon',
    caption: 'Wall Street.',
    alt: 'A Wall Street sign on a lamp post between tall stone buildings.',
  },

  // ---- after ----
  {
    slug: 'tulip-fields',
    asset: 'early-manias/tulip-field-rows-holland',
    flat: true,
    caption: 'Tulip fields in Holland today. The mania ended in 1637. The flowers stayed.',
    alt: 'Long straight rows of a tulip field beside a canal under a wide sky.',
  },
];
