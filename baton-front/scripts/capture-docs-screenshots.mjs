/**
 * Capture documentation screenshots from the preview build.
 *
 * Loads the self-contained preview (real UI + mocked auth + sample data),
 * walks each screen via the sidebar, and writes crisp PNGs into
 * src/docs/assets/screenshots/. Re-run after `npm run build:preview`.
 *
 *   node scripts/capture-docs-screenshots.mjs
 */
import { chromium } from '@playwright/test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const previewUrl = pathToFileURL(path.join(root, 'dist-preview', 'preview.html')).href;
const outDir = path.join(root, 'src', 'docs', 'assets', 'screenshots');
mkdirSync(outDir, { recursive: true });

// nav label (exact) → output file. Order follows the docs.
const SHOTS = [
  { file: 'flow-builder', nav: 'Flow Builder', settle: 2200, fitView: true },
  { file: 'bulk-upload', nav: 'Bulk Upload', settle: 1200 },
  { file: 'workflows', nav: 'Workflow Checker', settle: 1000 },
  { file: 'control-center', nav: /Control Center/, settle: 1200 },
  { file: 'connections', nav: 'Connections', settle: 1000 },
  { file: 'notifications', nav: 'Notifications', settle: 1000 },
  { file: 'settings', nav: 'Settings', settle: 1000 },
];

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1360, height: 840 },
  deviceScaleFactor: 2,
});

console.log('Loading preview:', previewUrl);
await page.goto(previewUrl, { waitUntil: 'load' });
await page.waitForTimeout(1200);

// Hide the "Preview Mode — Sample Data" banner and any toast notifications
// (transient mock-fetch errors) so they aren't captured in the shots.
await page.addStyleTag({
  content: '[data-sonner-toaster],[data-sonner-toast],.sonner-toast{display:none !important}',
});
await page.evaluate(() => {
  for (const el of Array.from(document.querySelectorAll('div'))) {
    if (el.textContent?.trim() === 'Preview Mode — Sample Data') el.style.display = 'none';
  }
});

for (const shot of SHOTS) {
  try {
    const exact = typeof shot.nav === 'string';
    await page.getByRole('link', { name: shot.nav, exact }).first().click();
    await page.waitForTimeout(shot.settle);

    // The canvas restores whatever viewport the saved layout had, which
    // leaves the flow off-centre once the fixture set changes. Re-fit so the
    // shot always frames the whole graph.
    if (shot.fitView) {
      const fit = page.locator('.react-flow__controls-fitview');
      if (await fit.count()) {
        await fit.first().click();
        await page.waitForTimeout(900);
      }
    }

    const out = path.join(outDir, `${shot.file}.png`);
    await page.screenshot({ path: out });
    console.log('✓', shot.file, '→', out);
  } catch (err) {
    console.error('✗', shot.file, '—', err.message);
  }
}

await browser.close();
console.log('Done.');
