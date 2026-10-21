import type { Page } from '@playwright/test';

/**
 * Renders a filled-in template page in the browser, the way a phone photo
 * would see it: slightly rotated, with a shadow gradient, and every box
 * written in (an italic serif stands in for handwriting).
 */
export async function fakeTemplatePhoto(page: Page, pageId: number): Promise<Buffer> {
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
export async function fakeHandwritingPhoto(page: Page, lines: string[]): Promise<Buffer> {
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
