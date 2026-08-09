/**
 * Capture animated product GIFs from the preview build.
 *
 * Usage:  npm run build:preview && node scripts/capture-product-gifs.mjs
 *
 * Frames are grabbed from the real UI (not a mockup) and encoded with gifenc.
 * Each shot declares its own frame plan so the pacing can be tuned per story
 * rather than recording at a fixed frame rate and hoping.
 *
 * Output: src/docs/assets/gifs/<name>.gif
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PNG } = require('pngjs');
const gifenc = require('gifenc');

const { GIFEncoder, quantize, applyPalette } = gifenc;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const previewUrl = pathToFileURL(path.join(root, 'dist-preview', 'preview.html')).href;
const outDir = path.join(root, 'src', 'docs', 'assets', 'gifs');
const tmpDir = path.join(root, '.gif-frames');
mkdirSync(outDir, { recursive: true });
if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
mkdirSync(tmpDir, { recursive: true });

// Content pane only — the tab strip on the site stands in for the app sidebar,
// and cropping keeps the nav out of marketing imagery where it would age badly.
// 4:3, matching the cropped stills so swapping still→GIF causes no layout shift.
const CLIP = { x: 240, y: 0, width: 1120, height: 840 };

async function record(page, frames, name) {
  const shots = [];
  let i = 0;
  const grab = async (delayMs) => {
    const file = path.join(tmpDir, `${name}-${String(i++).padStart(3, '0')}.png`);
    await page.screenshot({ path: file, clip: CLIP });
    shots.push({ file, delay: delayMs });
  };
  await frames(grab);
  return shots;
}

function encode(shots, outFile) {
  const gif = GIFEncoder();
  for (const { file, delay } of shots) {
    const png = PNG.sync.read(readFileSync(file));
    const data = new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.length);
    const palette = quantize(data, 256);
    gif.writeFrame(applyPalette(data, palette), png.width, png.height, { palette, delay });
  }
  gif.finish();
  const bytes = gif.bytes();
  writeFileSync(outFile, bytes);
  return bytes.length;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1360, height: 840 }, deviceScaleFactor: 1 });
await page.goto(previewUrl, { waitUntil: 'load' });
await page.waitForTimeout(1200);
await page.addStyleTag({
  content: '[data-sonner-toaster],[data-sonner-toast],.sonner-toast{display:none !important}',
});
// The preview build carries a "Preview Mode — Sample Data" badge; useful when
// clicking around, wrong in a marketing capture.
const hideBadge = async () => {
  await page.evaluate(() => {
    for (const el of Array.from(document.querySelectorAll('div'))) {
      if (el.textContent?.trim() === 'Preview Mode — Sample Data') el.style.display = 'none';
    }
  });
};
await hideBadge();

const results = [];

// ── 1. Flow Builder: the canvas with its live edges ──────────
{
  await page.getByRole('link', { name: 'Flow Builder', exact: true }).first().click();
  await page.waitForTimeout(2200);
  const fit = page.locator('.react-flow__controls-fitview');
  if (await fit.count()) { await fit.first().click(); await page.waitForTimeout(900); }

  const shots = await record(page, async (grab) => {
    // The edges animate continuously; 24 frames at 90ms reads as a smooth loop.
    for (let n = 0; n < 24; n++) await grab(90);
  }, 'flow');
  const size = encode(shots, path.join(outDir, 'flow-builder.gif'));
  results.push(['flow-builder.gif', shots.length, size]);
}

// ── 2. Bulk Upload: file → mapping → run → rows completing ───
{
  await page.getByRole('link', { name: 'Bulk Upload', exact: true }).first().click();
  await page.waitForTimeout(1400);

  const shots = await record(page, async (grab) => {
    await grab(1400); // the processor list, so the viewer gets their bearings

    await page.getByRole('button', { name: /Upload file/i }).first().click();
    await page.waitForTimeout(900);
    await grab(1100); // step 1, empty dropzone

    // Hand the picker a real file so the wizard follows its true code path.
    const csv = ['leadId,territory,source,company,ownerEmail',
      '00Q5f000004Ta1x,EMEA - North,Renewal,Northwind Trading,r.olsen@northwind.example',
      '00Q5f000004Tb2y,AMER - West,Renewal,Cascade Logistics,m.reyes@cascade.example'].join('\n');
    await page.locator('input[type="file"]').first().setInputFiles({
      name: 'renewals-q3.xlsx', mimeType: 'text/csv', buffer: Buffer.from(csv),
    });
    await page.waitForTimeout(500);
    await grab(500);   // uploading
    await page.waitForTimeout(900);
    await grab(1600);  // parsed: columns + preview rows

    for (const step of ['Mapping', 'Rows', 'Review']) {
      await page.getByRole('button', { name: /^(Next|Continue)/i }).first().click();
      await page.waitForTimeout(900);
      await grab(step === 'Mapping' ? 1900 : 1500);
    }

    await page.getByRole('button', { name: /Start|Run|Launch/i }).last().click();
    await page.waitForTimeout(1400);
    await hideBadge();
    await grab(1200); // back on the list, the card now shows a live run

    // Open the run so the rows themselves are visible while they complete.
    await page.getByRole('button', { name: /Runs & rows/i }).first().click();
    await page.waitForTimeout(1400);
    await hideBadge();
    await grab(900);

    for (let n = 0; n < 18; n++) { await page.waitForTimeout(550); await grab(280); }
    await grab(2200); // hold on the progressed state
  }, 'bulk');
  const size = encode(shots, path.join(outDir, 'bulk-upload.gif'));
  results.push(['bulk-upload.gif', shots.length, size]);
}

await browser.close();
rmSync(tmpDir, { recursive: true, force: true });

for (const [name, frames, size] of results) {
  console.log(`✓ ${name}  ${frames} frames  ${(size / 1024 / 1024).toFixed(2)} MB`);
}
