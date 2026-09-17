/** Layout is a binary split tree. `row` = children side by side (vertical seam),
 *  `col` = children stacked (horizontal seam). `ratio` is child `a`'s share. */
export type Dir = 'row' | 'col';

export type LeafNode = { kind: 'leaf'; id: string; photoId: string };
export type SplitNode = { kind: 'split'; id: string; dir: Dir; ratio: number; a: Node; b: Node };
export type Node = LeafNode | SplitNode;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Photo {
  id: string;
  name: string;
  /** Native pixel size, after EXIF orientation has been applied. */
  width: number;
  height: number;
  aspect: number;
  /** Downscaled bitmap used for all on-screen work (R8.1). */
  proxy: ImageBitmap;
  /** Original file, kept for the full-resolution export pass. */
  blob: Blob;
}

/** How a photo sits inside its cell. `zoom` is a multiplier on cover-fit, so 1
 *  always exactly covers the cell. `pan` is normalised to the hidden overflow,
 *  which keeps framing stable when the cell changes size. */
export interface Transform {
  zoom: number;
  panX: number;
  panY: number;
}

export const IDENTITY: Transform = { zoom: 1, panX: 0, panY: 0 };

export interface CanvasSettings {
  /** width / height */
  aspect: number;
  aspectLabel: string;
  /** All spacing is in layout units, where the canvas long edge is UNIT (1000). */
  gutter: number;
  margin: number;
  radius: number;
  background: string;
}

export interface Doc {
  root: Node | null;
  /** Photo ids in filmstrip order; drives layout assignment. */
  order: string[];
  /** Keyed by photo id so a photo carries its framing when it moves cell. */
  transforms: Record<string, Transform>;
  canvas: CanvasSettings;
}

export interface Cell {
  leafId: string;
  photoId: string;
  rect: Rect;
}

export interface Seam {
  nodeId: string;
  dir: Dir;
  /** The visible gap between the two children. */
  rect: Rect;
  /** The rect the split divides, needed to turn a pointer position into a ratio. */
  parent: Rect;
}

export interface Layout {
  w: number;
  h: number;
  cells: Cell[];
  seams: Seam[];
}

/** The canvas long edge in layout units. Everything is resolution independent;
 *  preview and export just pick a scale. */
export const UNIT = 1000;

export const MAX_PHOTOS = 20;
