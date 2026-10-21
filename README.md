# Fontbuilder

Turn handwriting into a real, installable font, entirely in the browser.

People upload a photo of their handwriting (or draw on screen), check the letters, and download an
OpenType font (`.otf`) they can install and use in Word, Pages, Outlook, Apple Mail, design apps and
websites. For places that can't use custom fonts (web Gmail, Google Docs) or where the reader won't
have the font installed, the app can also export what you typed as a transparent PNG to paste into an
email or signature.

Nothing is uploaded: images are processed and the font is built on the user's device.

## Three ways to add handwriting

| Method | Best for | How it works |
| --- | --- | --- |
| **Template** (recommended) | A complete, consistent font | Print a PDF with one box per character, fill it in, photograph it. The app finds the four corner squares, corrects perspective and rotation, reads the page number from the code strip at the bottom and cuts out every box. |
| **Photo of any handwriting** | Notes or pages you already have | The app finds letter shapes, groups dots and accents with their letters, sorts them into lines, and labels them from the text you type ("what does it say?"). You can fix labels, join pieces and skip smudges. Works with printed (separate) letters, not joined-up cursive. |
| **Draw on screen** | Filling gaps, touch devices | Draw with a finger, stylus or mouse on guide lines. It steps through missing characters automatically. |

Page 1 of the template covers A–Z, a–z, 0–9 and common punctuation (81 characters). Optional page 2
adds symbols, curly quotes and accented letters.

## What the font builder does

- Traces each letter into smooth vector outlines (pixel-edge contours → smoothing → simplification →
  quadratic curves, keeping sharp corners sharp).
- Evens out letter sizes and sits letters on the baseline (descenders like g, j, p, q, y keep their tails).
- Adds characters that apps insert automatically: curly quotes and apostrophes, en/em dashes, ellipsis,
  no-break space. Optionally uses capitals for missing small letters and vice versa.
- Adjustable thickness, letter spacing and word spacing, with a live preview.
- Sets vertical metrics so text isn't clipped on Windows and line spacing is comfortable.

Generated fonts pass [OTS](https://github.com/khaledhosny/ots) (the sanitizer browsers use) and load in
fontTools.

## Running it

```sh
npm install
npm run dev        # http://localhost:5173
npm run build      # static site in dist/
```

The build is a static site with relative paths, so `dist/` can be hosted anywhere. The included
`.github/workflows/deploy.yml` publishes it to GitHub Pages on every push to `main`; enable it once under
**Settings → Pages → Source: GitHub Actions**.

## Tests

```sh
npm test           # unit + integration tests (vitest)
npm run test:e2e   # browser tests (Playwright + Chromium)
```

The scanner tests render synthetic "phone photos" of a filled-in template (perspective, rotation,
uneven lighting, noise) and check that every written box, and only those, is found. The browser tests
run the full flows: template photo → font download, photo labelling, and drawing.

If Chromium is already installed somewhere, point Playwright at it with
`CHROMIUM_PATH=/path/to/chrome npm run test:e2e`.

## Project layout

```
src/core/          image processing and font building (no DOM; unit tested)
  template.ts      template geometry, PDF/SVG output, page codes
  scan.ts          marker detection, homography, per-box extraction
  freeform.ts      letter segmentation and labelling for arbitrary photos
  trace.ts         bitmap → smooth outlines
  outline.ts       glyph tracing in font units (thickness, smoothing)
  font.ts          OpenType font assembly (opentype.js)
  pdf.ts           minimal PDF writer for the template
src/ui/            the web interface
tests/             vitest tests and helpers
e2e/               Playwright tests
```

## Limitations

- Joined-up cursive can't be split into letters automatically; use the template or write letters separately.
- Uploads must be images (JPEG, PNG, WebP…). PDF scans need converting to an image first. HEIC photos work
  in Safari; other browsers need JPEG.
- The font has one form per character (no alternates or ligatures) and no kerning.
