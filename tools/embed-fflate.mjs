#!/usr/bin/env node
/*
 * embed-fflate.mjs — GROW NEST | TikTok Ship File Converter
 * ---------------------------------------------------------
 * Inlines the fflate UMD build into index.html so the app is 100% offline:
 * no CDN, no network requests, works when opened via file://.
 *
 * The very first run replaces the old CDN <script src="…cdnjs…fflate…"> line.
 * Every later run just refreshes the bytes between the
 *   /*FFLATE_UMD_START* / … /*FFLATE_UMD_END* /  markers (idempotent).
 *
 * Get the exact UMD build (must be the UMD build — it exposes a global `fflate`
 * in a plain <script>; the ESM build does not):
 *     npm pack fflate@0.8.2
 *     tar -xzf fflate-0.8.2.tgz          # -> package/umd/index.js
 *
 * Usage:
 *     node tools/embed-fflate.mjs <path-to/fflate/umd/index.js> <path-to/index.html>
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [, , umdPath, htmlPath] = process.argv;
if (!umdPath || !htmlPath) {
  console.error('Usage: node tools/embed-fflate.mjs <fflate/umd/index.js> <index.html>');
  process.exit(1);
}

const umd = readFileSync(umdPath, 'utf8').trim();
if (umd.includes('</script')) {
  console.error('Refusing to embed: UMD contains a "</script" sequence that would break the HTML.');
  process.exit(1);
}
const START = '/*FFLATE_UMD_START*/';
const END = '/*FFLATE_UMD_END*/';
const COMMENT =
  '<!-- fflate 0.8.2 (UMD) embedded inline so the app is 100% offline: no CDN, no network,\n' +
  '     works via file://. Regenerate with: node tools/embed-fflate.mjs <fflate/umd/index.js> index.html -->';
const scriptBlock = '<script>' + START + '\n' + umd + '\n' + END + '</script>';

let html = readFileSync(htmlPath, 'utf8');

// NOTE: replacement is passed as a function so the minified UMD's "$" sequences
// (e.g. $&, $`) are inserted literally and not treated as String.replace specials.
if (html.includes(START) && html.includes(END)) {
  // refresh existing inline block
  html = html.replace(
    /<script>\/\*FFLATE_UMD_START\*\/[\s\S]*?\/\*FFLATE_UMD_END\*\/<\/script>/,
    () => scriptBlock
  );
  console.log('✓ refreshed inline fflate block');
} else {
  // first embed: swap out the CDN <script src> (and its comment, if present)
  const cdnRe = /(?:<!--[^\n]*fflate[^\n]*-->\s*)?<script\s+src="https?:\/\/[^"]*fflate[^"]*"><\/script>/;
  if (!cdnRe.test(html)) {
    console.error('Could not find an inline marker block or a CDN fflate <script> to replace.');
    process.exit(1);
  }
  html = html.replace(cdnRe, () => COMMENT + '\n' + scriptBlock);
  console.log('✓ replaced CDN <script> with inline fflate');
}

// safety: no external script/style references should remain
const external = [...html.matchAll(/\b(?:src|href)\s*=\s*"(https?:)?\/\/[^"]*"/g)].map((m) => m[0]);
if (external.length) {
  console.error('✗ external references still present:\n  ' + external.join('\n  '));
  process.exit(1);
}

writeFileSync(htmlPath, html);
console.log(`✓ ${htmlPath} is now self-contained (fflate ${(umd.length/1024).toFixed(1)} KB inlined, 0 external requests)`);
