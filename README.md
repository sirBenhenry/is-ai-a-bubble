# Is AI a bubble?

A scrolling research piece in black and white. Real photographs stand in 3D behind the
text; the camera moves through them as you scroll.

## Run it

```
npm install
npm run dev        # http://localhost:5173, reloads as you edit
npm run build      # the finished site, in dist/
npm run preview    # look at dist/ before publishing
```

## Publishing

The site is online at <https://sirbenhenry.github.io/is-ai-a-bubble/>. Every push to `main`
is built and published there by GitHub Actions (`.github/workflows/pages.yml`); it takes
about a minute. A copy of this repository has to switch that on once: Settings, Pages,
Source: GitHub Actions.

`dist/` is plain static files, so it also runs on any other web host. It must be served
over http: opened by double-click, `dist/index.html` comes up as bare unstyled text, because
browsers block a page's own scripts and styles when it is loaded from disk.

## Where things are

| | |
|---|---|
| `index.html` | All the text. Every chapter, caption, source and credit. |
| `src/style.css` | The whole design: type, layout, where each photograph sits, each photograph's camera move. |
| `src/stage/` | The renderer that draws the photographs in 3D. |
| `src/charts.js`, `src/circle.js` | The two charts and the money-circle diagram. Their numbers are at the top of each file. |
| `plates.config.mjs` | Which photographs are used, how they are cropped, their captions. |
| `assets-src/` | The licence record (`manifest.json`) of every photograph. The originals themselves are not in the repository. |
| `tools/` | How photographs become plates, and the screenshot tool. See `tools/README.md`. |

## Writing the texts

The body text is still placeholder (lorem ipsum). Replace it in `index.html`; headings and
structure are already real. A chapter is built from three kinds of block:

- **an opener** (`<div class="opener">`): the chapter title over a photograph
- **a reading block** (`<div class="reading">`): text, with an optional photograph beside it.
  `reading--right` puts the text on the right and wants a `plate--left` photograph.
  A reading block without a `<figure>` is plain text on black; use those for breathing room.
- special pieces: the history sequence (`.eras`), the money circle (`.circle`), charts, the pop

Footnotes are `<sup class="ref"><a href="#source-12">12</a></sup>` and point at the numbered
list under Sources.

The chapter index (the screen behind "Chapters") is the `<nav class="index">` at the top of
`index.html`. If a chapter title changes, change it there too; `data-short` is the one-word
name shown in the corner while that chapter is being read.

Things still marked as samples and waiting for real numbers: the three "day in numbers"
figures and the shocks list in chapter 5, the stage gauge and the comparison chart in
chapter 6 (illustrative curves), the Nvidia milestones in chapter 4 (approximate), the
names in the money circle, and the authors' names.

## Photographs

To place a photograph that is already a plate:

```html
<figure class="plate plate--right" data-plate="pylons">
  <img src="plates/pylons.jpg" alt="…" loading="lazy">
  <figcaption>…</figcaption>
</figure>
```

Placement classes: `plate--right`, `plate--left` (half the screen, beside text),
`plate--wide` and `plate--full` (behind a title). The photograph appears while the block it
sits in (`data-beat`) is on screen. To add a new photograph, see `tools/README.md`.

Every photograph on the page is listed with its credit and licence under Photographs at the
end. Keep that list in step with what is used; several licences require it.
