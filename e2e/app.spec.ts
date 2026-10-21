import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import * as opentype from 'opentype.js';
import { fakeHandwritingPhoto, fakeTemplatePhoto } from './fakes';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test('template photo → font download', async ({ page }, testInfo) => {
  await expect(page.getByRole('heading', { name: 'Turn your handwriting into a font' })).toBeVisible();

  // The template PDF downloads.
  const [pdf] = await Promise.all([page.waitForEvent('download'), page.click('#download-template')]);
  expect(pdf.suggestedFilename()).toBe('handwriting-template.pdf');

  const photo = await fakeTemplatePhoto(page, 1);
  await page.setInputFiles('#template-input', { name: 'page1.jpg', mimeType: 'image/jpeg', buffer: photo });
  await expect(page.locator('#template-results li.ok')).toContainText('page 1, found 81 of 81 characters', { timeout: 60_000 });

  await expect(page.locator('#review-summary')).toContainText('81 of 81 basic characters');
  await expect(page.locator('#download-font')).toBeEnabled({ timeout: 60_000 });

  await page.fill('#font-name', 'Test Hand');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#download-font')]);
  expect(download.suggestedFilename()).toBe('Test Hand.otf');
  const file = testInfo.outputPath('Test Hand.otf');
  await download.saveAs(file);
  const bytes = readFileSync(file);
  const font = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  expect(font.names.fontFamily.en).toBe('Test Hand');
  for (const ch of 'AZaz09?&') expect(font.charToGlyphIndex(ch), ch).toBeGreaterThan(0);
  const H = font.charToGlyph('H').getBoundingBox();
  expect(H.y2 - H.y1).toBeGreaterThan(600);
  expect(H.y2 - H.y1).toBeLessThan(800);
  const p = font.charToGlyph('p').getBoundingBox();
  expect(p.y1).toBeLessThan(-100);

  // The preview really uses the generated font.
  const family = await page.evaluate(() => getComputedStyle(document.getElementById('preview-text')!).fontFamily);
  expect(family).toContain('Handwriting Preview');

  // Text as a picture, for email and Google Docs.
  const [png] = await Promise.all([page.waitForEvent('download'), page.click('#download-image')]);
  expect(png.suggestedFilename()).toBe('Test Hand.png');
  const pngBytes = readFileSync(await png.path());
  expect(pngBytes.subarray(1, 4).toString()).toBe('PNG');
  expect(pngBytes.readUInt32BE(16)).toBeGreaterThan(1000); // width
  await page.screenshot({ path: testInfo.outputPath('template-flow.png'), fullPage: true });
});

test('photo of handwriting → labelled letters', async ({ page }, testInfo) => {
  await page.click('#tab-photo');
  const lines = ['HELLO', 'world', '2024'];
  const photo = await fakeHandwritingPhoto(page, lines);
  await page.setInputFiles('#photo-input', { name: 'note.png', mimeType: 'image/png', buffer: photo });
  await expect(page.locator('#photo-status')).toContainText('Found 14 shapes on 3 lines', { timeout: 30_000 });
  await page.fill('#photo-text', lines.join('\n'));
  await expect(page.locator('#photo-add')).toHaveText('Add 12 letters to my font');
  await expect(page.locator('#photo-warnings li')).toHaveCount(0);
  await page.click('#photo-add');
  await expect(page.locator('#review-summary')).toContainText('12 of 81 basic characters');
  await expect(page.locator('#download-font')).toBeEnabled({ timeout: 30_000 });
  await page.screenshot({ path: testInfo.outputPath('photo-flow.png'), fullPage: true });
});

test('draw on screen, then remove a character', async ({ page }) => {
  await page.click('#tab-draw');
  await expect(page.locator('#draw-char')).toHaveValue('A');
  const line = async (a: [number, number], b: [number, number]) => {
    // Measure the canvas every time: other steps scroll the page.
    const canvas = page.locator('#draw-canvas');
    await canvas.scrollIntoViewIfNeeded();
    const box = (await canvas.boundingBox())!;
    const at = (x: number, y: number) => [box.x + (x / 400) * box.width, box.y + (y / 400) * box.height] as const;
    await page.mouse.move(...at(...a));
    await page.mouse.down();
    for (let i = 1; i <= 10; i += 1) await page.mouse.move(...at(a[0] + ((b[0] - a[0]) * i) / 10, a[1] + ((b[1] - a[1]) * i) / 10));
    await page.mouse.up();
  };
  await line([120, 295], [200, 95]);
  await line([200, 95], [280, 295]);
  await line([150, 220], [250, 220]);
  await page.click('#draw-save');
  await expect(page.locator('#draw-char')).toHaveValue('B');
  await expect(page.locator('#review-summary')).toContainText('1 of 81 basic characters');

  await page.locator('.glyph[aria-label="A"]').click();
  await expect(page.locator('#glyph-dialog')).toBeVisible();
  await expect(page.locator('#glyph-dialog-source')).toHaveText('Drawn on screen.');
  await page.click('#glyph-dialog-remove');
  await expect(page.locator('#review-summary')).toContainText('Nothing yet');

  // A "Start over" confirmation left open doesn't come back open later.
  await line([200, 95], [200, 295]);
  await page.click('#draw-save');
  await page.click('#clear-all');
  await expect(page.locator('#clear-confirm')).toBeVisible();
  await page.locator('.glyph[aria-label="B"]').click();
  await page.click('#glyph-dialog-remove');
  await line([200, 95], [200, 295]);
  await page.click('#draw-save');
  await expect(page.locator('#clear-all')).toBeVisible();
  await expect(page.locator('#clear-confirm')).toBeHidden();
});
