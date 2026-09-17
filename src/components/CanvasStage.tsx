import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react';
import { Cell, Layout, Node, Photo, Rect, Seam, Transform, IDENTITY, UNIT } from '../types';
import { cellAt, clamp, computeLayout, naturalAspect, seamAt, setRatio } from '../layout/tree';
import { coverScale, drawCollage, placePhoto, roundRectPath, scaleRect } from '../render/draw';
import { Action, AppState, transformOf } from '../state/store';

const MIN_CELL_SHARE = 0.05; // R4.4
const SEAM_GRAB_PX = 9;
const BADGE_PX = 26;
const FLIP_R = 13;
/** How far the pointer must travel before a press on the flip button becomes a resize. */
const DRAG_SLOP = 4;

interface Props {
  state: AppState;
  dispatch: (a: Action) => void;
  cropping: boolean;
  cropRect: Rect | null;
  onCropRect: (r: Rect | null) => void;
}

type Drag =
  | {
      kind: 'seam';
      seam: Seam;
      /** Cell geometry and zoom captured at pointerdown, so repeated moves never compound. */
      start: Map<string, { rect: Rect; zoom: number; pw: number; ph: number }>;
      /** Started on the flip button: a click flips the split, a drag still resizes it. */
      fromFlip: boolean;
      moved: boolean;
      origin: { x: number; y: number };
    }
  | { kind: 'pan'; photoId: string; from: { x: number; y: number }; startT: Transform; place: { ox: number; oy: number } }
  | { kind: 'swap'; photoId: string; over: string | null }
  | { kind: 'crop'; from: { x: number; y: number } }
  | null;

export default function CanvasStage({ state, dispatch, cropping, cropRect, onCropRect }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<{
    cell: string | null;
    seam: string | null;
    badge: boolean;
    flip: boolean;
  }>({ cell: null, seam: null, badge: false, flip: false });
  const dragRef = useRef<Drag>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const wheelTimer = useRef<number | null>(null);

  const { doc, photos } = state;
  const byId = useRef(new Map<string, Photo>());
  byId.current = new Map(photos.map((p) => [p.id, p]));

  const layout = computeLayout(doc.root, doc.canvas.aspect, doc.canvas.gutter, doc.canvas.margin);

  // Fit the canvas into whatever space the column gives us.
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setBox({ w: r.width, h: r.height });
    });
    ro.observe(el);
    const r = el.getBoundingClientRect();
    setBox({ w: r.width, h: r.height });
    return () => ro.disconnect();
  }, []);

  const fit = fitInto(layout.w, layout.h, box.w, box.h);
  const scale = fit.w > 0 ? fit.w / layout.w : 1;
  const u = (px: number) => px / scale;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (import.meta.env.DEV) {
      // Handy when tuning layout or debugging a drag: inspect window.__collage.
      (window as unknown as Record<string, unknown>).__collage = { doc, layout, scale, box, fit, hasCanvas: !!canvas };
    }
    if (!canvas || fit.w <= 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(fit.w * dpr);
    canvas.height = Math.round(fit.h * dpr);
    canvas.style.width = `${fit.w}px`;
    canvas.style.height = `${fit.h}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, fit.w, fit.h);

    drawCollage(ctx, layout, {
      scale,
      radius: doc.canvas.radius,
      background: doc.canvas.background,
      transforms: doc.transforms,
      getPhoto: (id) => {
        const p = byId.current.get(id);
        return p ? { bitmap: p.proxy, width: p.proxy.width, height: p.proxy.height } : undefined;
      },
    });

    drawChrome(ctx, layout, scale, {
      hover,
      selected: state.selected,
      drag: dragRef.current,
      cropping,
      cropRect,
    });
  }, [layout, scale, fit, box, doc, hover, state.selected, cropping, cropRect]);

  useEffect(() => {
    const id = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(id);
  }, [draw]);

  const toUnit = (e: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const r = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * layout.w,
      y: ((e.clientY - r.top) / r.height) * layout.h,
    };
  };

  const badgeRectFor = (cell: Cell): Rect => ({
    x: cell.rect.x + u(8),
    y: cell.rect.y + u(8),
    w: u(BADGE_PX),
    h: u(BADGE_PX),
  });

  const inRect = (r: Rect, x: number, y: number) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

  /** The flip button sits at the middle of a seam, and only while that seam is hovered. */
  const onFlipButton = (seam: Seam, x: number, y: number) => {
    const cx = seam.rect.x + seam.rect.w / 2;
    const cy = seam.rect.y + seam.rect.h / 2;
    return Math.hypot(x - cx, y - cy) <= u(FLIP_R + 2);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!doc.root) return;
    const { x, y } = toUnit(e);
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // Pointer already released, or a synthetic event; dragging still works.
    }

    if (cropping) {
      dragRef.current = { kind: 'crop', from: { x, y } };
      onCropRect({ x, y, w: 0, h: 0 });
      return;
    }

    const seam = seamAt(layout, x, y, u(SEAM_GRAB_PX));
    if (seam) {
      const start = new Map<string, { rect: Rect; zoom: number; pw: number; ph: number }>();
      for (const c of layout.cells) {
        const p = byId.current.get(c.photoId);
        if (!p) continue;
        start.set(c.photoId, {
          rect: c.rect,
          zoom: transformOf(doc, c.photoId).zoom,
          pw: p.proxy.width,
          ph: p.proxy.height,
        });
      }
      dispatch({ type: 'begin' });
      dragRef.current = {
        kind: 'seam',
        seam,
        start,
        fromFlip: onFlipButton(seam, x, y),
        moved: false,
        origin: { x, y },
      };
      return;
    }

    const cell = cellAt(layout, x, y);
    if (!cell) return;
    dispatch({ type: 'select', photoId: cell.photoId });

    if (inRect(badgeRectFor(cell), x, y)) {
      dragRef.current = { kind: 'swap', photoId: cell.photoId, over: null };
      return;
    }

    const photo = byId.current.get(cell.photoId);
    if (!photo) return;
    const place = placePhoto(cell.rect, photo.proxy.width, photo.proxy.height, transformOf(doc, cell.photoId));
    dispatch({ type: 'begin' });
    dragRef.current = {
      kind: 'pan',
      photoId: cell.photoId,
      from: { x, y },
      startT: transformOf(doc, cell.photoId),
      place: { ox: place.overflowX, oy: place.overflowY },
    };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!doc.root) return;
    const { x, y } = toUnit(e);
    const drag = dragRef.current;

    if (!drag) {
      const seam = cropping ? null : seamAt(layout, x, y, u(SEAM_GRAB_PX));
      const cell = seam ? null : cellAt(layout, x, y);
      const badge = !!cell && !cropping && inRect(badgeRectFor(cell), x, y);
      const flip = !!seam && onFlipButton(seam, x, y);
      const seamId = seam?.nodeId ?? null;
      const cellId = cell?.photoId ?? null;
      if (seamId !== hover.seam || cellId !== hover.cell || badge !== hover.badge || flip !== hover.flip) {
        setHover({ seam: seamId, cell: cellId, badge, flip });
      }
      return;
    }

    if (drag.kind === 'crop') {
      const r = normalise(drag.from, { x, y });
      onCropRect({
        x: clamp(r.x, 0, layout.w),
        y: clamp(r.y, 0, layout.h),
        w: Math.min(r.w, layout.w - r.x),
        h: Math.min(r.h, layout.h - r.y),
      });
      return;
    }

    if (drag.kind === 'seam') {
      const { seam } = drag;
      if (drag.fromFlip && !drag.moved) {
        // Hold the resize back until the press clearly is not a click on the button.
        if (Math.hypot(x - drag.origin.x, y - drag.origin.y) < u(DRAG_SLOP)) return;
        dragRef.current = { ...drag, moved: true };
      }
      const raw =
        seam.dir === 'row' ? (x - seam.parent.x) / seam.parent.w : (y - seam.parent.y) / seam.parent.h;
      const ratio = clamp(raw, 0.02, 0.98);
      const current = stateRef.current.doc;
      if (!current.root) return;
      const candidate = computeLayout(
        setRatio(current.root, seam.nodeId, ratio),
        current.canvas.aspect,
        current.canvas.gutter,
        current.canvas.margin,
      );
      // Refuse the drag rather than letting a cell collapse (R4.4).
      const minW = layout.w * MIN_CELL_SHARE;
      const minH = layout.h * MIN_CELL_SHARE;
      if (candidate.cells.some((c) => c.rect.w < minW || c.rect.h < minH)) return;

      // The shrinking neighbour keeps the on-screen size of its photo and simply
      // reveals less of it, instead of rescaling out from under the user (R4.3).
      const patch: Record<string, Transform> = {};
      for (const c of candidate.cells) {
        const s = drag.start.get(c.photoId);
        if (!s) continue;
        const before = coverScale(s.rect, s.pw, s.ph) * Math.max(1, s.zoom);
        const after = coverScale(c.rect, s.pw, s.ph);
        const zoom = Math.max(1, before / after);
        const t = transformOf(current, c.photoId);
        if (Math.abs(zoom - t.zoom) > 0.0005) patch[c.photoId] = { ...t, zoom };
      }
      dispatch({ type: 'drag-seam', nodeId: seam.nodeId, ratio, transforms: patch });
      return;
    }

    if (drag.kind === 'pan') {
      const dx = x - drag.from.x;
      const dy = y - drag.from.y;
      const panX = drag.place.ox > 0 ? clamp(drag.startT.panX - dx / drag.place.ox, -0.5, 0.5) : 0;
      const panY = drag.place.oy > 0 ? clamp(drag.startT.panY - dy / drag.place.oy, -0.5, 0.5) : 0;
      dispatch({ type: 'set-transform', photoId: drag.photoId, transform: { ...drag.startT, panX, panY } });
      return;
    }

    if (drag.kind === 'swap') {
      const cell = cellAt(layout, x, y);
      const over = cell && cell.photoId !== drag.photoId ? cell.photoId : null;
      if (over !== drag.over) {
        dragRef.current = { ...drag, over };
        requestAnimationFrame(draw);
      }
    }
  };

  const onPointerUp = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag?.kind === 'swap' && drag.over) dispatch({ type: 'swap', a: drag.photoId, b: drag.over });
    // A press on the flip button that never became a drag turns the split instead.
    if (drag?.kind === 'seam' && drag.fromFlip && !drag.moved) {
      dispatch({ type: 'flip-seam', nodeId: drag.seam.nodeId });
    }
    dispatch({ type: 'end' });
  };

  const onWheel = (e: ReactWheelEvent<HTMLCanvasElement>) => {
    if (!doc.root || cropping) return;
    const { x, y } = toUnit(e);
    const cell = cellAt(layout, x, y);
    if (!cell) return;
    const photo = byId.current.get(cell.photoId);
    if (!photo) return;

    if (wheelTimer.current === null) dispatch({ type: 'begin' });
    else window.clearTimeout(wheelTimer.current);
    wheelTimer.current = window.setTimeout(() => {
      wheelTimer.current = null;
      dispatch({ type: 'end' });
    }, 400);

    const t = transformOf(doc, cell.photoId);
    const max = maxZoom(cell.rect, photo);
    const zoom = clamp(t.zoom * Math.exp(-e.deltaY * 0.0015), 1, max);
    dispatch({ type: 'set-transform', photoId: cell.photoId, transform: { ...t, zoom } });
  };

  const onDoubleClick = (e: ReactMouseEvent<HTMLCanvasElement>) => {
    if (!doc.root || cropping) return;
    const { x, y } = toUnit(e);
    const seam = seamAt(layout, x, y, u(SEAM_GRAB_PX));
    if (seam) {
      // Back to the ratio the layout engine picked.
      const node = findNode(doc.root, seam.nodeId);
      if (node && node.kind === 'split') {
        const aspectOf = (id: string) => byId.current.get(id)?.aspect ?? 1;
        const aa = naturalAspect(node.a, aspectOf);
        const ab = naturalAspect(node.b, aspectOf);
        const ratio = clamp(node.dir === 'row' ? aa / (aa + ab) : ab / (aa + ab), 0.05, 0.95);
        dispatch({ type: 'begin' });
        dispatch({ type: 'drag-seam', nodeId: seam.nodeId, ratio });
        dispatch({ type: 'end' });
      }
      return;
    }
    const cell = cellAt(layout, x, y);
    if (cell) {
      dispatch({ type: 'begin' });
      dispatch({ type: 'set-transform', photoId: cell.photoId, transform: IDENTITY });
      dispatch({ type: 'end' });
    }
  };

  const cursor = (() => {
    if (cropping) return 'crosshair';
    if (hover.flip) return 'pointer';
    if (hover.badge) return 'grab';
    if (hover.seam) {
      const s = layout.seams.find((x) => x.nodeId === hover.seam);
      return s?.dir === 'row' ? 'ew-resize' : 'ns-resize';
    }
    if (dragRef.current?.kind === 'pan') return 'grabbing';
    return hover.cell ? 'move' : 'default';
  })();

  return (
    <div className="stage" ref={wrapRef}>
      {doc.root && (
        <canvas
          ref={canvasRef}
          className="stage-canvas"
          style={{ cursor }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={() => setHover({ cell: null, seam: null, badge: false, flip: false })}
          onWheel={onWheel}
          onDoubleClick={onDoubleClick}
        />
      )}
    </div>
  );
}

function fitInto(w: number, h: number, boxW: number, boxH: number) {
  if (boxW <= 0 || boxH <= 0) return { w: 0, h: 0 };
  const pad = 24;
  const aw = Math.max(0, boxW - pad);
  const ah = Math.max(0, boxH - pad);
  const s = Math.min(aw / w, ah / h);
  return { w: w * s, h: h * s };
}

function normalise(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

function findNode(root: Node, id: string): Node | null {
  if (root.id === id) return root;
  if (root.kind === 'leaf') return null;
  return findNode(root.a, id) ?? findNode(root.b, id);
}

/**
 * Zoom ceiling (R5.4). "100% of source pixels" needs a reference resolution, so
 * it is measured against a 2048px export. Small photos still get 2x of headroom —
 * the export warns about upscaling rather than the editor forbidding it.
 */
export function maxZoom(cell: Rect, photo: Photo): number {
  const coverPx = coverScale(scaleRect(cell, 2048 / UNIT), photo.width, photo.height);
  const nativeCap = 1 / coverPx;
  return clamp(Math.max(nativeCap, 2), 1, 5);
}

interface ChromeOpts {
  hover: { cell: string | null; seam: string | null; badge: boolean; flip: boolean };
  selected: string | null;
  drag: Drag;
  cropping: boolean;
  cropRect: Rect | null;
}

function drawChrome(ctx: CanvasRenderingContext2D, layout: Layout, scale: number, o: ChromeOpts) {
  const s = (r: Rect): Rect => ({ x: r.x * scale, y: r.y * scale, w: r.w * scale, h: r.h * scale });

  if (o.cropping) {
    const full = { x: 0, y: 0, w: layout.w * scale, h: layout.h * scale };
    const sel = o.cropRect && o.cropRect.w > 2 && o.cropRect.h > 2 ? s(o.cropRect) : full;
    ctx.save();
    ctx.fillStyle = 'rgba(8,10,14,0.55)';
    ctx.beginPath();
    ctx.rect(full.x, full.y, full.w, full.h);
    ctx.rect(sel.x + sel.w, sel.y, -sel.w, sel.h);
    ctx.fill('evenodd');
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(sel.x, sel.y, sel.w, sel.h);
    ctx.fillStyle = '#ffffff';
    for (const [hx, hy] of [
      [sel.x, sel.y],
      [sel.x + sel.w, sel.y],
      [sel.x, sel.y + sel.h],
      [sel.x + sel.w, sel.y + sel.h],
    ]) {
      ctx.fillRect(hx - 4, hy - 4, 8, 8);
    }
    ctx.restore();
    return;
  }

  const swapping = o.drag?.kind === 'swap' ? o.drag : null;

  for (const cell of layout.cells) {
    const r = s(cell.rect);
    const isHover = o.hover.cell === cell.photoId;
    const isSelected = o.selected === cell.photoId;
    const isSwapSource = swapping?.photoId === cell.photoId;
    const isSwapTarget = swapping?.over === cell.photoId;

    if (isSwapTarget) {
      ctx.save();
      ctx.fillStyle = 'rgba(77,171,247,0.35)';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = '#4dabf7';
      ctx.lineWidth = 3;
      ctx.strokeRect(r.x + 1.5, r.y + 1.5, r.w - 3, r.h - 3);
      ctx.restore();
    } else if (isSwapSource) {
      ctx.save();
      ctx.fillStyle = 'rgba(8,10,14,0.35)';
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.restore();
    } else if (isSelected) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
      ctx.restore();
    }

    if (isHover && !swapping) {
      const b = { x: r.x + 8, y: r.y + 8, w: BADGE_PX, h: BADGE_PX };
      ctx.save();
      roundRectPath(ctx, b, 7);
      ctx.fillStyle = o.hover.badge ? 'rgba(77,171,247,0.95)' : 'rgba(12,14,18,0.72)';
      ctx.fill();
      ctx.fillStyle = '#fff';
      for (let gx = 0; gx < 2; gx++) {
        for (let gy = 0; gy < 3; gy++) {
          ctx.beginPath();
          ctx.arc(b.x + 9 + gx * 8, b.y + 7 + gy * 6, 1.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }
  }

  const activeSeam = o.drag?.kind === 'seam' ? o.drag.seam.nodeId : o.hover.seam;
  if (activeSeam) {
    const seam = layout.seams.find((x) => x.nodeId === activeSeam);
    if (seam) {
      const r = s(seam.rect);
      ctx.save();
      ctx.fillStyle = 'rgba(77,171,247,0.9)';
      if (seam.dir === 'row') ctx.fillRect(r.x + r.w / 2 - 1.5, r.y, 3, r.h);
      else ctx.fillRect(r.x, r.y + r.h / 2 - 1.5, r.w, 3);

      // The flip button, hidden once a resize is actually under way.
      if (!(o.drag?.kind === 'seam' && o.drag.moved)) {
        const cx = r.x + r.w / 2;
        const cy = r.y + r.h / 2;
        ctx.beginPath();
        ctx.arc(cx, cy, FLIP_R, 0, Math.PI * 2);
        ctx.fillStyle = o.hover.flip ? '#4dabf7' : 'rgba(10,12,16,0.85)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.lineWidth = 1;
        ctx.stroke();
        // The icon shows the arrangement you would get, not the one you have.
        ctx.fillStyle = '#fff';
        if (seam.dir === 'row') {
          ctx.fillRect(cx - 5, cy - 4.5, 10, 3.5);
          ctx.fillRect(cx - 5, cy + 1, 10, 3.5);
        } else {
          ctx.fillRect(cx - 4.5, cy - 5, 3.5, 10);
          ctx.fillRect(cx + 1, cy - 5, 3.5, 10);
        }
      }
      ctx.restore();
    }
  }
}
