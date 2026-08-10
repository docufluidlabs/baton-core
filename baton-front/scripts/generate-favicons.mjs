/**
 * Rasterise the brand favicon tile into its PNG fallbacks.
 *
 * Usage:  npm run favicons
 *
 * Everything is rendered from public/favicon.svg, so the raster set can't drift
 * from the vector one. Re-run after any change to that file.
 *
 * Output: public/favicon-96x96.png, public/apple-touch-icon.png
 */
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(root, 'public');
const svg = readFileSync(path.join(pub, 'favicon.svg'), 'utf8');

// Apple applies its own mask to touch icons, so that one ships square and
// full-bleed - a pre-rounded tile would get rounded twice and look pinched.
const square = svg.replace(/rx="350" ry="350"/, 'rx="0" ry="0"');

const OUT = [
  { file: 'favicon-96x96.png', size: 96, src: svg, transparent: true },
  { file: 'apple-touch-icon.png', size: 180, src: square, transparent: false },
];

const browser = await chromium.launch();
for (const { file, size, src, transparent } of OUT) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(
    `<style>html,body{margin:0;padding:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${src}`,
    { waitUntil: 'load' },
  );
  const buf = await page.screenshot({ omitBackground: transparent });
  writeFileSync(path.join(pub, file), buf);
  console.log(`✓ ${file}  ${size}x${size}  ${buf.length} bytes`);
  await page.close();
}
await browser.close();
