# GROW NEST — TikTok Ship File Converter

Internal tool for **GROW NEST** (e-commerce operations). Converts an Amazon
tracking **`.txt`** export into a TikTok Shop **"Ship File" `.xlsx`** that
uploads cleanly into Seller Center.

It is a **single, offline `index.html`** — inline CSS + JS, no build step, no
backend, no dependencies to install. The only external request is the `fflate`
library from a CDN. Your file never leaves the browser.

> UI language is **Roman Urdu** (labels/messages); technical terms stay English.

---

## Why this approach

TikTok's Ship File template is a very specific `.xlsx`. Regenerating it with a
normal library (SheetJS / openpyxl) **strips the carrier dropdown
data-validation and a hidden `meta_info_sheet`** that TikTok's parser requires —
so the upload fails.

So this app does the opposite: it takes **TikTok's real template file** and edits
**only the data rows** inside it, leaving every other byte untouched. An `.xlsx`
is just a zip of XML — the app uses `fflate` to unzip it, rewrites one worksheet,
and re-zips it.

The real template is embedded in `index.html` as a base64 string
(`TEMPLATE_B64`), so the app stays 100% self-contained and offline.

### The template's 4 sheets (all preserved)

| # | Sheet | State | Role |
|---|-------|-------|------|
| 1 | `Shipping info` | visible | The data sheet — **only this is edited** |
| 2 | `shipping_provider_name_drop_lis` | hidden | 24 carrier names for the dropdown (`A1:A24`) |
| 3 | `meta_info_sheet` | hidden | JSON config TikTok's parser reads — **byte-preserved** |
| 4 | `Provider list` | visible | Reference sheet |

### What gets written to `Shipping info`

Rows 1–3 (instructions / headers / labels) are kept exactly. Data starts at
**row 4**. Only **3 of 10 columns** are filled — the rest stay empty:

| Column | Field |
|--------|-------|
| **A** | Order ID |
| **H** | Shipping provider name |
| **I** | Tracking ID |

Each data cell is an `inlineStr` with style **`s="5"`** and each row gets a
list data-validation pointing at `shipping_provider_name_drop_lis!A1:A24`, so the
carrier dropdown works on every row.

> **Note on cell style (`s="5"` vs `s="4"`):** the original spec said `s="4"`,
> but reading the real template shows `s="4"` is the **filled header** style and
> `s="5"` is the **borderless data-cell** style the template's own data rows use.
> We use `s="5"` so data rows render as data, not as highlighted headers. The
> style is cosmetic — TikTok's parser reads cell *values*, not styles — so either
> uploads fine. Change `DATA_STYLE` in `index.html` if you prefer `"4"`.

---

## Usage

1. Open **`index.html`** in any modern browser (double-click — no server needed).
2. Drag-and-drop (or browse to) your Amazon tracking **`.txt`** export.
3. Check the preview / stats, then click **Download Ship File (.xlsx)**.
4. Upload the downloaded file into TikTok Seller Center.

Output filename: `TikTok_Ship_File_YYYYMMDD_HHMM.xlsx`.

### Input format

Tab-separated, UTF-8. Header row uses Amazon's column names. Only three are read:
`order-id`, `carrier-name` (often blank), `tracking-number`. Header detection is
case-insensitive and tolerant (`order id` / `order-id` / `orderid`,
`tracking number` / `tracking-number` / `tracking-id`, …). If `order-id` or
`tracking-number` is missing, a clear error is shown.

### Carrier mapping

`carrier-name` is usually blank → provider defaults to **`Correos`**. When
present, common spellings are mapped to the exact dropdown spelling
(`seur → Seur`, `mrw → MRW`, `gls → GLS Spain`, `ctt → CTT Express`,
`ups → UPS®`, `dhl → DHL Express`, `fedex → FedEx`, `nacex → NACEX`,
`correos express → Correos Express`, `amazon shipping es → Amazon Shipping ES`,
…). Unknown values pass through as-is. Every mapped value must match a name in
the 24-item dropdown exactly.

---

## Project layout

```
index.html                         The app (open this). Embeds TEMPLATE_B64.
tools/prep-template.mjs            Regenerates TEMPLATE_B64 from a template .xlsx.
template/Ship_File_Template.xlsx   TikTok's official template (source for prep).
sample/Seguimiento_Amazon_sample.txt   Sanitized sample input (fake data).
```

## Regenerating the embedded template

If TikTok ships an updated template, drop it in and re-run the prep tool:

```bash
cd tools && npm install fflate    # one-time
node prep-template.mjs ../template/Ship_File_Template.xlsx ../index.html
```

This strips the filler rows from the `Shipping info` sheet, inserts the
`__DATAROWS__` / `__DATAVAL__` markers, blanks any orphaned sample strings for
privacy, re-zips, base64-encodes, and splices the result into `index.html`
between the `TEMPLATE_B64_START` / `TEMPLATE_B64_END` markers.

## Privacy

- **No uploads, no server, no `localStorage`/`sessionStorage`.** Everything runs
  in the browser; the file never leaves the machine.
- The only network request is loading `fflate` from
  `cdnjs.cloudflare.com`.
- The prep tool blanks any leftover sample order/tracking values from the source
  template so no real order data ships in the embedded base64.

## Verified

The generated `.xlsx` was parsed back (headless Chromium + `fflate`, and
independently with `openpyxl`) confirming: all 4 sheets present with correct
visible/hidden states, headers intact on row 2, data in columns A/H/I from row 4,
exactly one dropdown validation per data row pointing at `A1:A24`, and
`meta_info_sheet` byte-identical to the original template. The UI was checked for
horizontal overflow down to 360px width.
