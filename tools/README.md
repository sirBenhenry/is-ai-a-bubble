# Tools

## How a photograph becomes a plate

Every moving photograph on the page is a **plate**: the photograph in black and white, plus a
**depth map** that says how near each part of it is. The page stands the photograph up in 3D
as a sheet of soft discs at those distances and moves a camera past them.

```
assets-src/<folder>/<image>            the original, with its licence record in manifest.json
        │  plates.config.mjs           which images, how they are cropped, their captions
        ▼
npm run plates
        │  1. crop  →  build/plates/in/<slug>.jpg
        │  2. depth →  on the depth machine, over SSH (Depth Pro 2)
        │  3. tone  →  public/plates/<slug>.jpg  +  public/plates/<slug>.depth.png
        ▼
src/plates.generated.json              what the page loads: sizes, focal length, distances, credits
```

The original photographs are not in the repository (see `.gitignore`): they are large, and
only their licence records are published. On a computer without them, `npm run plates`
leaves the built plates as they are and still updates captions, alt texts and credits.
To re-crop a photograph you need its original; every record's `sourcePage` says where it
came from.

Add a photograph: put it in `assets-src/`, add its licence record to that folder's
`manifest.json` (the tool refuses images whose `verdict` is not `keep`), add an entry to
`plates.config.mjs`, run `npm run plates -- <slug>`, then place it in `index.html` with
`<figure class="plate plate--right" data-plate="<slug>"></figure>`.

`npm run plates` also keeps `index.html` in step: it rewrites the image, alt text and
caption inside every plate figure, and the whole list under Photographs (credit, linked
licence, source), from `plates.config.mjs` and the manifests. So edit captions in
`plates.config.mjs`, not in `index.html`. It warns about plates that are built but not
used: remove those, because everything in `public/plates/` is published.

Read each image's `reason` and `cropAdvice` in its manifest before writing a caption or a
crop. They record what the licence check found: dates, what the picture really shows, and
anything that must be cropped out (people who are not public figures, number plates).

### Which photographs work

Depth only shows where things stand in front of other things, from near to far: an aisle,
a street between buildings, a crowd, a railing in front of a hall. A distant subject on a
flat backdrop (a skyline, a building across water) just shears when the camera moves.
Close portraits are risky: small depth errors on a face look wrong. Give each plate its own
camera move in `src/style.css` (`--plate-travel` and friends): push forward by default, move
sideways only where there are real layers, and keep blur small.

### When a photograph breaks up

Look at both ends of the move (`node tools/shoot-plate.mjs <slug>`, below) at the screen
shapes people use. What goes wrong, and what fixes it:

| What you see | Why | Fix |
|---|---|---|
| A subject on a black background tears at its outline | black has no depth to speak of; the model invents one | `depth: { fillBlack: 12 }` in `plates.config.mjs` |
| Wires, lattice or railings break into dashes | they are thinner than the depth map can hold | `depth: { open: 9 }` (they then move with what is behind them) |
| Glass, soap film, a painting: ragged or noisy edges | their depth is noise | `depth: { smooth: 4 }` up to `12` |
| Swirls or saw-teeth beside a near object | the camera travels further than the photograph can cover | smaller `--plate-travel` in `src/style.css` |
| Soft blobs where a near object meets the dissolving edge | loose grains near the lens are out of focus | smaller `--plate-bokeh` and `--plate-scatter` |
| The dissolving edge eats the subject (half a word on a sign) | the subject sits where the picture dissolves | `--plate-anchor: 0.4 0.63` puts that point of the photograph's width at that point of the box's width, on any screen shape; narrow the edge with `--plate-soft` |

The `depth` options are applied to the model's depth map when the plate is built
(`cleanDepth` in `tools/make-plates.mjs`); `npm run plates -- <slug> --local` rebuilds from
the depth already fetched, without the depth machine.

## The depth machine

Depth runs on a second computer because the models are large. Any Linux machine with about
8 GB of free memory will do; no graphics card is needed (about 20 seconds per photograph on
8 CPU cores).

1. Copy `tools/server/setup.sh` there and run it once: `bash setup.sh`. For the optional
   second model (SHARP, below) run `WITH_SHARP=1 bash setup.sh` instead.
2. Make sure `ssh <name>` works without a prompt from this computer.
3. Write that name into a file called `.plates-host` in the project folder (one line; the
   file is not in the repository), or pass it each time: `PLATES_HOST=<name> npm run plates`.

`PLATES_MODEL` picks the model size (`depthpro2-s`, `-b`, `-l` default, `-h`) and
`PLATES_MAX_LONG` the size it works at (default 1536 px; memory grows with its square).

### Models and their licences

| Model | Used for | Licence |
|---|---|---|
| [Depth Pro 2](https://github.com/apple-aiml-research/ml-depth-pro-2) (Apple, November 2026) | the depth maps | weights: Apple Machine Learning Research Model License, research use only |
| [SHARP](https://github.com/apple/ml-sharp) (Apple, December 2025) | optional, `--depth sharp` | same research-only licence |

Both models come under the Apple Machine Learning Research Model License. It covers
*using the model*: the grant is personal and revocable, and "exclusively for Research
Purposes", defined as non-commercial scientific research and academic development. The
licence does not mention what the model produces, and the depth maps are outputs, not
copies or derivatives of the model. Our reading is that a school research project is
research use. That is a reading, not legal advice: check with a teacher if in doubt, and
if the site is ever used commercially, switch to a permissively licensed depth model
(MoGe-2 or MoGe-3, MIT) and rebuild the plates.

Depth is an estimate. The page says so above the list of photographs; repeat it in the
Method section when that is written.

### A note on this particular server

On the Xen virtual machine used for this project, PyTorch's oneDNN library crashes with a
floating-point exception on some 1x1 convolutions. `sharp_cpu.py` and `depthpro2_plate.py`
route those through the plain code path. On ordinary hardware the workaround does nothing.

## Screenshots

```
npm run dev                                   in one terminal
npm run shoot -- --frames 24 --sheet          24 frames down the page, plus a contact sheet
npm run shoot -- --sel "#boom" --offset 400   one section
npm run shoot -- --mobile --frames 12 --sheet
npm run shoot -- --perf                       scroll the whole page and report frame times
```

Shots land in `shots/`. The tools drive Chrome at `/usr/bin/google-chrome-stable`; if yours
is somewhere else, say where: `CHROME=/path/to/chrome npm run shoot`.
`tools/contact-sheet.mjs` lays any set of image files out as one black-and-white sheet
(`node tools/contact-sheet.mjs out.jpg 4 480 a.jpg b.jpg ...`), for comparing candidates.

Two more checks while tuning a photograph's camera move:

```
node tools/shoot-plate.mjs keynote aisle      start and end of each move, side by side
SIZE=1920x1080 FULL=1 node tools/shoot-plate.mjs keynote      another window size; keep both frames at full size
node tools/perf-beat.mjs "#boom" 600          frame times while scrolling inside one section
```
