// Builds the app as one self-contained HTML fragment for publishing as a
// claude.ai Artifact: scripts and styles inlined, and no <html>/<head>/<body>
// skeleton (the Artifact host adds its own).
//
//   node scripts/build-artifact.mjs [output.html]

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { build } from 'vite';

// Vite empties its output folder, so build into a subfolder and keep the result beside it.
const outDir = 'dist-artifact/.build';
const output = resolve(process.argv[2] ?? 'dist-artifact/fontbuilder.html');

await build({
  logLevel: 'warn',
  build: {
    outDir,
    emptyOutDir: true,
    cssCodeSplit: false,
    modulePreload: false,
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
  },
});

const html = readFileSync(join(outDir, 'index.html'), 'utf8');
const asset = (file) => readFileSync(join(outDir, file.replace(/^\.\//, '')), 'utf8');

const cssFiles = [...html.matchAll(/<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g)].map((m) => m[1]);
const jsFiles = [...html.matchAll(/<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g)].map((m) => m[1]);
if (cssFiles.length !== 1 || jsFiles.length !== 1) {
  throw new Error(`Expected one stylesheet and one script, found ${cssFiles.length} and ${jsFiles.length}`);
}
// A literal "</script" inside the bundle would end the inline script early.
const js = asset(jsFiles[0]).replace(/<\/script/gi, '<\\/script');
const css = asset(cssFiles[0]);

const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(html)?.[1];
if (!body) throw new Error('No <body> in the built page');

const page = [
  '<title>Fontbuilder</title>',
  `<style>\n${css}\n</style>`,
  body.trim(),
  `<script type="module">\n${js}\n</script>`,
  '',
].join('\n');

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, page);
console.log(`Wrote ${output} (${(page.length / 1024).toFixed(0)} KB)`);
