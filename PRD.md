# Collage Maker — PRD

**Version** 1.0 · **Date** 2026-09-17 · **Status** Approved for build

---

## 1. Summary

A browser-based collage maker. Drop in up to 20 photos of any dimensions, get a
good layout proposed automatically, adjust it by dragging seams and zooming
photos in place, crop, and export a high-resolution image.

Everything runs client-side. No upload, no account, no backend.

## 2. Goals

- Turn a pile of mixed-aspect photos into a good-looking collage in under two minutes.
- Make the automatic first suggestion good enough that adjustment is optional.
- Make every adjustment direct: drag the thing you want to change.
- Ship as a static site — personal use now, public use later, same build.

## 3. Non-goals (v1)

Text, stickers, filters, borders-as-decoration, shapes other than rectangles,
multi-page output, free-form overlapping placement, accounts, sharing links,
cloud storage, video, native mobile apps.

## 4. Platform

Client-side single-page web app. Static hosting, no server component. Photos are
read with the File API and never transmitted. Usable offline after first load.

## 5. Core flow

1. Drop photos in (up to 20).
2. Pick a canvas aspect ratio (default 1:1).
3. Review the suggested layouts; pick one.
4. Adjust — drag seams to resize cells, zoom/pan photos inside their cells, swap photos between cells.
5. Crop the whole collage if desired.
6. Export as PNG or JPEG.

---

## 6. Requirements

### R1 — Import

| | |
|---|---|
| R1.1 | Accept 1–20 images via drag-and-drop onto the page, or a file picker. |
| R1.2 | Support JPEG, PNG, WebP, GIF (first frame). Any pixel dimensions, any aspect ratio. |
| R1.3 | Honor EXIF orientation — a phone photo must not appear sideways. |
| R1.4 | Show a filmstrip of imported photos; allow removing and adding after layout exists. |
| R1.5 | Reject the 21st image with a clear message rather than failing silently. |

### R2 — Automatic layout

| | |
|---|---|
| R2.1 | Generate candidate layouts by recursive binary partition of the canvas — every layout is a tree of horizontal/vertical splits, so the result is always a gapless rectangle. |
| R2.2 | Score each candidate on: crop loss (pixels of each photo hidden by its cell), cell-size balance, and minimum cell size. Lower crop loss wins; a layout that mangles one photo loses to one that treats all photos fairly. |
| R2.3 | Photo aspect ratios drive assignment — portraits land in tall cells, landscapes in wide ones. |
| R2.4 | Present the top 5 candidates as clickable thumbnails. The best one is applied immediately on import. |
| R2.5 | Layout generation is deterministic — the same photos in the same order produce the same suggestions. |
| R2.6 | Complete within 300ms for 20 photos. |
| R2.7 | Changing the canvas aspect ratio re-runs layout. Adding or removing a photo re-runs layout and warns first if manual adjustments would be lost. |
| R2.8 | Alongside the scored suggestions, offer named structural templates — Grid, Rows of N, Columns of N, Hero on each side, and so on — filtered to the ones that make sense for the current photo count. The user can take the algorithm's ranking or impose a shape of their own. |
| R2.9 | Remember which suggestion or template produced the current arrangement, and re-apply that choice when the photo order or canvas shape changes. |

### R3 — Canvas

| | |
|---|---|
| R3.1 | Aspect presets: 1:1, 4:5, 3:2, 2:3, 16:9, 9:16, plus custom W:H. |
| R3.2 | Adjustable gutter (space between photos), outer margin, and background color. Gutter default 8px-equivalent; 0 produces a seamless collage. |
| R3.3 | Optional corner rounding on photos, 0 by default. |

### R4 — Resizing cells

| | |
|---|---|
| R4.1 | Hovering a seam between cells shows a resize cursor; dragging it moves the boundary. |
| R4.2 | Growing a cell takes space from its neighbor. Because layouts are split trees, every seam separates exactly two regions, so the result is always unambiguous and the collage stays gapless. |
| R4.3 | **The shrinking neighbor holds its zoom and simply shows less of its photo.** Photos never rescale out from under the user during a drag. |
| R4.4 | Enforce a minimum cell size (5% of canvas width/height); the drag stops there rather than collapsing a cell. |
| R4.5 | Double-clicking a seam resets it to its layout-computed position. |
| R4.6 | Dragging one photo onto another swaps their positions; each photo keeps its own zoom and pan. |
| R4.7 | Each seam carries a control that turns a row into a column and back, re-solving that split's ratio for its new direction. Pressing the control and dragging resizes the seam as usual, so one gesture never blocks the other. |

### R5 — Zoom and pan within a cell

| | |
|---|---|
| R5.1 | Scroll wheel or pinch over a photo zooms it inside its cell. The cell does not move or resize. |
| R5.2 | Dragging a zoomed photo pans it within its cell. |
| R5.3 | Pan is clamped so no empty space can appear inside a cell — the photo always fully covers its frame. |
| R5.4 | Zoom range: from cover-fit (minimum) up to 100% of source pixels or 5x, whichever is smaller. |
| R5.5 | Double-clicking a photo resets it to cover-fit, centered. |

### R6 — Cropping the collage

| | |
|---|---|
| R6.1 | A crop mode lets the user drag a rectangle over the finished collage. |
| R6.2 | Cells reflow proportionally into the cropped area — the collage is rebuilt at the new aspect, not letterboxed or scaled non-uniformly. |
| R6.3 | Per-photo zoom and pan survive the crop. |
| R6.4 | The crop is undoable and the original framing recoverable. |

### R7 — Export

| | |
|---|---|
| R7.1 | Export PNG (lossless) or JPEG (quality slider, default 92). |
| R7.2 | Choose output size by long edge, with presets: 1080px (social), 2048px, 4096px, and Max (largest size the source photos support without upscaling). |
| R7.3 | Render at full resolution from the original files, not from the on-screen preview. |
| R7.4 | Show progress during export; complete 20 photos at 4096px in under 10 seconds on a typical laptop. |
| R7.5 | Never upscale a photo beyond its native resolution without warning. |

### R8 — Performance

| | |
|---|---|
| R8.1 | Editing operates on downscaled proxies (~2048px long edge); full-resolution decodes happen only at export. |
| R8.2 | Seam drags and zoom/pan stay at 60fps with 20 photos loaded. |
| R8.3 | Peak memory stays under 1GB with 20 photos of 24MP each. |

### R9 — Session safety

| | |
|---|---|
| R9.1 | Autosave the working state (layout, zoom/pan, settings, image references) so an accidental refresh does not lose work. |
| R9.2 | Undo/redo across every edit: layout choice, seam drag, zoom/pan, swap, crop, settings. Minimum 50 steps. |

---

## 7. Edge cases

| Situation | Behavior |
|---|---|
| One photo | Fills the canvas; zoom/pan and crop still work. |
| Photo lower-resolution than its cell needs | Allowed on screen; export warns if it would upscale past native. |
| Extreme aspect ratio (panorama, very tall) | Layout scoring strongly prefers giving it a matching cell rather than cropping it to a square. |
| Duplicate images | Treated as independent photos. |
| Photo removed after manual adjustment | Layout re-runs for the remaining photos; warn before discarding adjustments. |
| Corrupt or unreadable file | Skipped with a named error; the rest of the batch still imports. |

## 8. Success criteria

- The first suggested layout is accepted with no adjustment at least half the time.
- 12 photos to exported file in under 2 minutes, first-time user, no instructions.
- No photo data leaves the device — verifiable in the network tab.
- Works in current Chrome, Safari, Firefox, and Edge on desktop.

## 9. Technical sketch

React + TypeScript, Vite, Canvas 2D rendering, no backend. The layout is a split
tree: internal nodes are horizontal or vertical splits with a ratio, leaves are
cells holding a photo reference plus its zoom and pan. That single structure
makes automatic generation, seam dragging, and proportional reflow-on-crop all
fall out naturally — which is why it, and not free-form rectangles, is the
foundation.

## 10. Later

HEIC/RAW import · face- and subject-aware crop positioning · free-form overlap
mode · saveable project files and reusable custom layouts · touch/mobile layout ·
shareable links.
