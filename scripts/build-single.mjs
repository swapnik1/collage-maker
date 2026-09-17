/**
 * Folds the built app into one self-contained HTML file you can double-click.
 *
 * A normal Vite build loads its JavaScript as a separate module file, and
 * browsers refuse to fetch module files over file:// — so dist/index.html only
 * works when something is serving it. Inlining the script and stylesheet removes
 * the fetch, and the page then runs straight off the filesystem, offline.
 *
 * Runs automatically as part of `npm run build`.
 */
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const indexPath = join(dist, 'index.html');

if (!existsSync(indexPath)) {
  console.error('dist/index.html not found — run `vite build` first.');
  process.exit(1);
}

let html = readFileSync(indexPath, 'utf8');
const used = [];

/** Inline a referenced file, keeping its content from closing the tag early. */
const safe = (code) => code.replace(/<\/script/gi, '<\\/script');

html = html.replace(
  /<script([^>]*?)\ssrc="\.?\/?([^"]+)"([^>]*)><\/script>/gi,
  (whole, before, src, after) => {
    const file = join(dist, src);
    if (!existsSync(file)) return whole;
    used.push(src);
    const attrs = `${before}${after}`.replace(/\scrossorigin/gi, '').trim();
    return `<script ${attrs}>\n${safe(readFileSync(file, 'utf8'))}\n</script>`;
  },
);

html = html.replace(/<link[^>]*rel="stylesheet"[^>]*href="\.?\/?([^"]+)"[^>]*>/gi, (whole, href) => {
  const file = join(dist, href);
  if (!existsSync(file)) return whole;
  used.push(href);
  return `<style>\n${readFileSync(file, 'utf8')}\n</style>`;
});

const out = join(dist, 'collage-maker.html');
writeFileSync(out, html);

// The inlined originals are dead weight in the single-file build, but
// dist/index.html still references them, so only drop them on request.
if (process.argv.includes('--only-single')) {
  for (const src of used) rmSync(join(dist, src), { force: true });
  rmSync(indexPath, { force: true });
}

const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
console.log(`dist/collage-maker.html  ${kb} kB  (self-contained, opens from the filesystem)`);
