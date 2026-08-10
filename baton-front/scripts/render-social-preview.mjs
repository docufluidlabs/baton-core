/**
 * Render .github/media/social-preview.png (1280x640, GitHub's 2:1 spec)
 * from scripts/social-preview.html + the brand kit's on-dark logotype.
 *
 * Usage: node scripts/render-social-preview.mjs
 */
import { chromium } from '@playwright/test';
import { copyFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');

// The logotype lives in the site repo's brand kit; copy it next to the HTML
// so the file:// page can load it, then clean up.
const logoSrc = path.resolve(root, '..', 'iambaton-site', 'public', 'brand', 'baton-logo-main-white.svg');
const logoTmp = path.join(here, 'baton-logo-main-white.svg');
copyFileSync(logoSrc, logoTmp);

const out = path.join(root, '.github', 'media', 'social-preview.png');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(path.join(here, 'social-preview.html')).href, { waitUntil: 'networkidle' });
await page.waitForTimeout(400); // let the webfont settle
await page.screenshot({ path: out });
await browser.close();
unlinkSync(logoTmp);
console.log('✓ wrote', out);
