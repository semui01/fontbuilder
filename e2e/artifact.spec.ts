import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import * as opentype from 'opentype.js';
import { readStoredZip } from '../src/core/zip';
import { fakeTemplatePhoto } from './fakes';

/*
 * The single-file build published as a claude.ai Artifact. The viewer blocks
 * direct downloads and offers files through its `downloads` capability
 * (reached via window.claude.use). These tests stand in for the viewer.
 */

const ARTIFACT_URL = 'https://fontbuilder.artifact.test/';
let fragment = '';

test.beforeAll(() => {
  execFileSync('node', ['scripts/build-artifact.mjs', 'dist-artifact/e2e.html'], { stdio: 'pipe' });
  fragment = readFileSync('dist-artifact/e2e.html', 'utf8');
});

type Mode = 'accept' | 'decline' | 'none';

interface Saved {
  filename: string;
  base64: string;
}

/** Serves the build inside an Artifact-like skeleton with a stand-in `downloads` capability. */
async function openArtifact(page: Page, mode: Mode): Promise<void> {
  const doc =
    '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
    `<style>[hidden]{display:none!important}</style></head><body>${fragment}</body></html>`;
  await page.route(ARTIFACT_URL, (route) => route.fulfill({ contentType: 'text/html', body: doc }));
  await page.addInitScript((m: Mode) => {
    const saves: Saved[] = [];
    (window as unknown as { __saves: Saved[] }).__saves = saves;
    const downloads = Object.freeze({
      save: async ({ filename, data }: { filename: string; data: Blob }) => {
        if (m === 'decline') throw { code: 'declined', message: 'The viewer declined.' };
        const bytes = new Uint8Array(await data.arrayBuffer());
        let binary = '';
        for (const b of bytes) binary += String.fromCharCode(b);
        saves.push({ filename, base64: btoa(binary) });
        return { status: 'saved' };
      },
    });
    // Like the real host: `use` exists up front, the namespace arrives later.
    (window as unknown as { claude: unknown }).claude = {
      use: (name: string) =>
        new Promise((resolve) => setTimeout(() => resolve(name === 'downloads' && m !== 'none' ? downloads : null), 50)),
    };
  }, mode);
  await page.goto(ARTIFACT_URL);
}

async function nextSave(page: Page, count: number): Promise<{ filename: string; bytes: Buffer }> {
  await expect.poll(() => page.evaluate(() => (window as unknown as { __saves: Saved[] }).__saves.length)).toBe(count);
  const saved = await page.evaluate((i) => (window as unknown as { __saves: Saved[] }).__saves[i], count - 1);
  return { filename: saved.filename, bytes: Buffer.from(saved.base64, 'base64') };
}

test('artifact build: every file goes through the viewer, the font as a zip', async ({ page }) => {
  await page.goto('/');
  const photo = await fakeTemplatePhoto(page, 1);
  await openArtifact(page, 'accept');

  // No print dialog in the viewer; the PDF covers printing.
  await expect(page.locator('#print-template')).toBeHidden();
  await page.click('#download-template');
  const pdf = await nextSave(page, 1);
  expect(pdf.filename).toBe('handwriting-template.pdf');
  expect(pdf.bytes.subarray(0, 5).toString()).toBe('%PDF-');

  await page.setInputFiles('#template-input', { name: 'page1.jpg', mimeType: 'image/jpeg', buffer: photo });
  await expect(page.locator('#template-results li.ok')).toContainText('found 81 of 81', { timeout: 60_000 });
  await expect(page.locator('#download-font')).toBeEnabled({ timeout: 60_000 });
  await expect(page.locator('#download-font')).toHaveText('Download font (.zip)');
  await expect(page.locator('#download-note')).toBeVisible();

  await page.fill('#font-name', 'Demo Hand');
  await page.click('#download-font');
  const zip = await nextSave(page, 2);
  expect(zip.filename).toBe('Demo Hand.zip');
  const entries = readStoredZip(new Uint8Array(zip.bytes));
  expect(entries.map((e) => e.name)).toEqual(['Demo Hand.otf', 'How to install.txt']);
  const otf = entries[0].data;
  const font = opentype.parse(otf.buffer.slice(otf.byteOffset, otf.byteOffset + otf.byteLength));
  expect(font.names.fontFamily.en).toBe('Demo Hand');
  expect(font.charToGlyphIndex('A')).toBeGreaterThan(0);
  await expect(page.locator('#download-status')).toHaveText('');

  await page.click('#download-image');
  const png = await nextSave(page, 3);
  expect(png.filename).toBe('Demo Hand.png');
  expect(png.bytes.subarray(1, 4).toString()).toBe('PNG');

  // "Start over" asks on the page itself (the viewer blocks confirm()).
  await page.click('#clear-all');
  await page.click('#clear-no');
  await expect(page.locator('#review-summary')).toContainText('81 of 81');
  await page.click('#clear-all');
  await page.click('#clear-yes');
  await expect(page.locator('#review-summary')).toContainText('Nothing yet');
});

test('artifact build: a declined download is reported', async ({ page }) => {
  await openArtifact(page, 'decline');
  await page.click('#download-template');
  await expect(page.locator('#template-status')).toHaveText('Download cancelled.');
});

test('artifact build: says so when the viewer cannot save files', async ({ page }) => {
  await openArtifact(page, 'none');
  await page.click('#download-template');
  await expect(page.locator('#template-status')).toHaveText("This view can't save files. Try opening the page in a web browser.");
});
