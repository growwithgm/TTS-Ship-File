#!/usr/bin/env node
/*
 * prep-template.mjs — GROW NEST | TikTok Ship File Converter
 * -----------------------------------------------------------
 * Turns TikTok's REAL "Ship File" .xlsx template into the marker template that
 * index.html embeds as TEMPLATE_B64.
 *
 * What it does (and ONLY this — every other byte in the archive is left alone):
 *   1. Unzip the .xlsx with fflate (an .xlsx is just a zip of XML).
 *   2. In the "Shipping info" sheet (the worksheet that holds the A1:J1 merged
 *      instructions cell), strip every filler/empty row below the 3 header rows.
 *   3. Insert two markers:
 *        __DATAROWS__  inside <sheetData>, right after row 3  -> data rows go here
 *        __DATAVAL__   where the <dataValidations> block lived -> validations go here
 *   4. Re-zip and base64-encode the result.
 *   5. Write tools/template.b64.txt, and (if index.html is passed) splice the
 *      base64 between the TEMPLATE_B64_START / TEMPLATE_B64_END markers in it.
 *
 * The 3 other sheets (hidden dropdown list, hidden meta_info_sheet, visible
 * Provider list), sharedStrings, styles, drawings, etc. are NEVER decoded or
 * touched, so TikTok's parser sees the exact bytes it shipped.
 *
 * Usage:
 *   node tools/prep-template.mjs <path-to-Ship_File_Template.xlsx> [path-to-index.html]
 *
 * Re-run this whenever TikTok updates the official template.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';

const [, , templatePath, indexPath] = process.argv;
if (!templatePath) {
  console.error('Usage: node tools/prep-template.mjs <template.xlsx> [index.html]');
  process.exit(1);
}

// --- 1. unzip -------------------------------------------------------------
const zip = unzipSync(new Uint8Array(readFileSync(templatePath)));

// --- 2. locate the data worksheet (the one with the A1:J1 merged cell) ----
// We match on the merged instructions cell so we don't depend on sheetN naming.
const sheetPath = Object.keys(zip).find(
  (p) => /xl\/worksheets\/sheet\d+\.xml$/.test(p) &&
         strFromU8(zip[p]).includes('<mergeCell ref="A1:J1"/>')
);
if (!sheetPath) {
  console.error('Could not find the "Shipping info" worksheet (A1:J1 merge). Is this the right template?');
  process.exit(1);
}

let xml = strFromU8(zip[sheetPath]);

// --- 3. surgery -----------------------------------------------------------
// (a) keep header rows 1-3, drop all rows after row 3, drop in __DATAROWS__.
const r3 = xml.indexOf('<row r="3"');
if (r3 === -1) { console.error('Header row 3 not found.'); process.exit(1); }
const r3Close = xml.indexOf('</row>', r3) + '</row>'.length;
const sheetDataClose = xml.indexOf('</sheetData>', r3Close);
if (sheetDataClose === -1) { console.error('</sheetData> not found.'); process.exit(1); }
xml = xml.slice(0, r3Close) + '__DATAROWS__' + xml.slice(sheetDataClose);

// (b) replace the existing <dataValidations> block with __DATAVAL__.
if (!/<dataValidations[\s>]/.test(xml)) {
  console.error('No <dataValidations> block found to replace.');
  process.exit(1);
}
xml = xml.replace(/<dataValidations\b[^>]*>[\s\S]*?<\/dataValidations>/, '__DATAVAL__');

zip[sheetPath] = strToU8(xml);

// --- 3b. scrub orphaned shared strings (privacy hygiene) ------------------
// TikTok's exported template pre-fills 1-2 sample rows using the seller's own
// order-id / tracking values, stored in sharedStrings.xml. We removed those
// filler rows above, so those strings are now referenced by NO sheet. Blank
// them out (keeping every <si> in place so indices never shift) so no real
// order data ships in the embedded template. Strings still used by any sheet —
// headers, the 24 provider names, "Required/Optional", and the meta_info JSON —
// are matched as "referenced" and left exactly as-is.
const ssPath = 'xl/sharedStrings.xml';
if (zip[ssPath]) {
  const referenced = new Set();
  for (const p of Object.keys(zip)) {
    if (/xl\/worksheets\/sheet\d+\.xml$/.test(p)) {
      const wx = strFromU8(zip[p]);
      for (const m of wx.matchAll(/t="s"[^>]*>\s*<v>(\d+)<\/v>/g)) referenced.add(Number(m[1]));
    }
  }
  let idx = 0, scrubbed = 0;
  const ss = strFromU8(zip[ssPath]).replace(/<si>[\s\S]*?<\/si>/g, (si) => {
    const keep = referenced.has(idx++);
    if (keep) return si;
    scrubbed++;
    return '<si><t></t></si>';
  });
  zip[ssPath] = strToU8(ss);
  console.log(`✓ orphan strings  : ${scrubbed} blanked (leftover sample order/tracking values)`);
}

// --- 4. re-zip + base64 ---------------------------------------------------
const out = zipSync(zip, { level: 6 });
const b64 = Buffer.from(out).toString('base64');
writeFileSync(new URL('./template.b64.txt', import.meta.url), b64);

console.log(`✓ data worksheet : ${sheetPath}`);
console.log(`✓ markers inserted: __DATAROWS__ (after row 3), __DATAVAL__ (validations)`);
console.log(`✓ archive entries : ${Object.keys(zip).length} (only the data sheet changed)`);
console.log(`✓ base64 length   : ${b64.length} chars  ->  tools/template.b64.txt`);

// --- 5. optionally splice into index.html ---------------------------------
if (indexPath) {
  let html = readFileSync(indexPath, 'utf8');
  const START = '/*TEMPLATE_B64_START*/';
  const END = '/*TEMPLATE_B64_END*/';
  const s = html.indexOf(START), e = html.indexOf(END);
  if (s === -1 || e === -1) {
    console.error(`Could not find ${START} / ${END} markers in ${indexPath}.`);
    process.exit(1);
  }
  html = html.slice(0, s + START.length) + '\n  "' + b64 + '"\n  ' + html.slice(e);
  writeFileSync(indexPath, html);
  console.log(`✓ patched         : ${indexPath} (TEMPLATE_B64 updated)`);
}
