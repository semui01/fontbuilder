import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import * as opentype from 'opentype.js';

/**
 * Renders a filled-in template page in the browser, the way a phone photo
 * would see it: slightly rotated, with a shadow gradient, and every box
 * written in (an italic serif stands in for handwriting).
 */
async function fakeTemplatePhoto(page: Page, pageId: number): Promise<Buffer> {
  const dataUrl = await page.evaluate(async (id) => {
    // Served by the Vite dev server; imported via a variable so tsc doesn't try to resolve the URL.
    const base = '/src/core/';
    const { templateSvg, pageCells } = (await import(`${base}template.ts`)) as typeof import('../src/core/template');
    const { PAGES } = (await import(`${base}charset.ts`)) as typeof import('../src/core/charset');
    const tpl = PAGES.find((p) => p.id === id)!;
    const paper = { w: 215.9, h: 279.4 };
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(templateSvg(tpl, 'letter'))}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 1900;
    canvas.height = 2400;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#5b5148';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const pxPerMm = 8;
    ctx.translate(130, 110);
    ctx.rotate((2.5 * Math.PI) / 180);
    ctx.scale(pxPerMm, pxPerMm);
    ctx.drawImage(img, 0, 0, paper.w, paper.h);
    // Handwriting, in page millimetres.
    const ox = (paper.w - 180) / 2;
    const oy = (paper.h - 250) / 2;
    ctx.fillStyle = '#1b2a6b';
    ctx.font = 'italic 13px FreeSerif, serif';
    ctx.textAlign = 'center';
    for (const cell of pageCells(tpl)) {
      ctx.fillText(cell.char, ox + cell.box.x + cell.box.w / 2, oy + cell.baseY);
    }
    // Uneven lighting.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const shade = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    shade.addColorStop(0, 'rgba(0,0,0,0)');
    shade.addColorStop(1, 'rgba(60,40,20,0.25)');
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.9);
  }, pageId);
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

/** A photo of free-form "handwriting" on lined paper. */
async function fakeHandwritingPhoto(page: Page, lines: string[]): Promise<Buffer> {
  const dataUrl = await page.evaluate(async (textLines) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1600;
    canvas.height = 220 + textLines.length * 170;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#f4f1ea';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#a9c4e6';
    ctx.lineWidth = 3;
    for (let y = 150; y < canvas.height; y += 170) {
      ctx.beginPath();
      ctx.moveTo(0, y + 4);
      ctx.lineTo(canvas.width, y + 4);
      ctx.stroke();
    }
    ctx.fillStyle = '#1b1f3a';
    ctx.font = 'italic 110px FreeSerif, serif';
    textLines.forEach((line, i) => {
      let x = 90;
      for (const ch of line) {
        ctx.fillText(ch, x, 150 + i * 170);
        // Generous spacing so letters don't touch, like printed handwriting.
        x += ctx.measureText(ch).width + 22;
      }
    });
    return canvas.toDataURL('image/png');
  }, lines);
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

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
  const box = (await page.locator('#draw-canvas').boundingBox())!;
  const at = (x: number, y: number) => [box.x + (x / 400) * box.width, box.y + (y / 400) * box.height] as const;
  const line = async (a: [number, number], b: [number, number]) => {
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
});
