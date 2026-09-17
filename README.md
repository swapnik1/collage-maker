# Collage Maker

Drop in up to 20 photos, get a good layout proposed automatically, adjust it by
dragging seams and zooming photos in place, crop, and export a high-resolution
image. Everything runs in the browser — no upload, no account, no backend.

Built to [PRD.md](PRD.md).

## Run it

Build once:

```bash
npm install
npm run build
```

That writes two things into `dist/`:

- **`collage-maker.html`** — the whole app in one file, script and stylesheet
  inlined. Double-click it. No server, no Node, no network. Move it anywhere,
  keep it on a USB stick, bookmark it. This is the one to use day to day.
- **`index.html` + `assets/`** — the conventional split build, for hosting.

There is no runtime and nothing to install for the person using it. Node is
needed to *build* the app, not to run it.

### Hosting it

`dist/` is plain static files, so GitHub Pages, Netlify, Cloudflare Pages or any
web server will serve it as-is. Asset paths are relative, so a subdirectory works
too. Nothing ever leaves the visitor's browser, so there is no backend to pair
with it and no data to look after.

### Working on it

```bash
npm run dev
```

Hot reload at http://localhost:5173. Only needed while changing the code.

> One caveat when running straight off the filesystem: some browsers refuse
> IndexedDB on `file://`, so the autosave that survives a reload may be inactive
> there. The app detects this and carries on without it — you just start fresh
> each time you open the file. Hosting it at a real URL, even a local one,
> restores autosave.

## How it works

The whole app rests on one structure: **the layout is a binary split tree.**
Internal nodes are a horizontal or vertical split with a ratio, leaves are cells
holding a photo plus its zoom and pan.

That one choice makes four features fall out of the same code:

- **Automatic layout** — candidate trees are generated, then each tree's ratios
  are solved so that no photo is cropped at all: widths add across a row, heights
  add down a column, so a subtree has a *natural aspect* and the optimal ratio at
  each split follows from its children. The only cropping left is the global
  squeeze into the canvas shape, which every photo then shares equally.
- **Dragging seams** — a seam always separates exactly two subtrees, so a drag is
  never ambiguous and the collage stays a gapless rectangle.
- **Cropping** — the same tree laid into a different canvas shape.
- **Removing a photo** — collapse its split and promote its sibling, which keeps
  every other adjustment intact.

Photo framing is stored as `zoom` (a multiplier on cover-fit, so 1 always exactly
covers) and `pan` normalised to the hidden overflow. Because both are relative,
framing survives the cell changing size, and empty space can never be panned into
view.

### Layout files

| File | What it does |
|---|---|
| [src/layout/tree.ts](src/layout/tree.ts) | The tree, rect computation, seam hit-testing, ratio solving |
| [src/layout/generate.ts](src/layout/generate.ts) | Candidate generation and scoring |
| [src/render/draw.ts](src/render/draw.ts) | Photo placement and canvas drawing, shared by preview and export |
| [src/render/exporter.ts](src/render/exporter.ts) | Full-resolution render, one photo decoded at a time |
| [src/state/store.ts](src/state/store.ts) | Reducer, undo/redo |

### Tuning the suggestions

Whether the first suggestion is good enough to accept untouched lives entirely in
the weights at the top of [src/layout/generate.ts](src/layout/generate.ts). After
changing them, run the harness:

```bash
npx esbuild scripts/layout-check.ts --bundle --format=esm --outfile=.tmp/check.mjs && node .tmp/check.mjs
```

It prints, for a range of photo sets, how long generation took, how much of each
photo the best layout crops away, how starved the smallest cell is, and an ASCII
map of the arrangement — then runs assertions over the geometry rules.

In development, `window.__collage` holds the current document and computed
layout. It is compiled out of production builds.

## Performance

Editing works on proxies downscaled to 2048px; full-resolution decodes happen
only at export, one photo at a time, so peak memory stays near a single decode.
Measured on a 20-photo set: layout generation 31ms, export at 4096px 1.5s.

## Not in this version

Text, stickers, filters, decorative borders, non-rectangular cells, multi-page
output, free-form overlapping placement, accounts, sharing links, cloud storage.

HEIC is not supported — browsers cannot decode it natively and it needs a WASM
decoder. iPhone photos in HEIC will be skipped with a message saying so.

## Licence

MIT — see [LICENSE](LICENSE).
