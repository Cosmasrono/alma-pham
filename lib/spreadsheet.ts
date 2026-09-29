/** Reads the first sheet of an .xlsx workbook, or a CSV file, into rows of
 *  cell text — in the browser, with no dependencies. An .xlsx is a zip of XML
 *  parts: we find the sheet (and shared-strings table) through the zip's
 *  central directory and inflate them with the built-in DecompressionStream. */
export async function readSpreadsheet(file: File): Promise<string[][]> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  // Every zip (and so every .xlsx) starts with "PK".
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return readXlsx(bytes);
  return parseCsv(new TextDecoder().decode(bytes).replace(/^﻿/, ""));
}

/** RFC 4180 CSV: quoted fields may contain commas, quotes ("") and newlines. */
export function parseCsv(text: string): string[][] {
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some(Boolean));
}

/** Excel in some locales saves "CSV" with semicolons. */
function detectDelimiter(text: string): string {
  const end = text.search(/\r?\n/);
  const firstLine = end === -1 ? text : text.slice(0, end);
  const count = (d: string) => firstLine.split(d).length;
  return count(";") > count(",") ? ";" : count("\t") > count(",") ? "\t" : ",";
}

// --- xlsx ------------------------------------------------------------------

async function readXlsx(bytes: Uint8Array): Promise<string[][]> {
  const entries = zipEntries(bytes);
  const text = async (path: string) => {
    const e = entries.get(path);
    return e ? inflateEntry(bytes, e) : null;
  };

  const sheetPath = await firstSheetPath(entries, text);
  const sheetXml = await text(sheetPath);
  if (!sheetXml) throw new Error("This workbook has no readable sheet.");

  const shared: string[] = [];
  const sharedXml = await text("xl/sharedStrings.xml");
  if (sharedXml) {
    for (const si of Array.from(xml(sharedXml).getElementsByTagName("si"))) {
      shared.push(allText(si));
    }
  }

  const rows: string[][] = [];
  for (const r of Array.from(xml(sheetXml).getElementsByTagName("row"))) {
    const row: string[] = [];
    for (const c of Array.from(r.getElementsByTagName("c"))) {
      const col = columnIndex(c.getAttribute("r") ?? "") ?? row.length;
      const type = c.getAttribute("t");
      const v = c.getElementsByTagName("v")[0]?.textContent ?? "";
      let value: string;
      if (type === "s") value = shared[Number(v)] ?? "";
      else if (type === "inlineStr") value = allText(c.getElementsByTagName("is")[0]);
      else value = v;
      while (row.length < col) row.push("");
      row[col] = value.trim();
    }
    if (row.some(Boolean)) rows.push(row);
  }
  return rows;
}

/** The workbook's first sheet, following the relationship ids (the part name
 *  isn't always sheet1.xml). */
async function firstSheetPath(
  entries: Map<string, ZipEntry>,
  text: (p: string) => Promise<string | null>,
): Promise<string> {
  const fallback = "xl/worksheets/sheet1.xml";
  const [wb, rels] = await Promise.all([text("xl/workbook.xml"), text("xl/_rels/workbook.xml.rels")]);
  if (!wb || !rels) return fallback;
  const sheet = xml(wb).getElementsByTagName("sheet")[0];
  const rid = sheet?.getAttribute("r:id") ?? sheet?.getAttributeNS(
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "id",
  );
  for (const rel of Array.from(xml(rels).getElementsByTagName("Relationship"))) {
    if (rel.getAttribute("Id") === rid) {
      const target = (rel.getAttribute("Target") ?? "").replace(/^\/?(xl\/)?/, "");
      const path = `xl/${target}`;
      return entries.has(path) ? path : fallback;
    }
  }
  return fallback;
}

function xml(s: string) {
  return new DOMParser().parseFromString(s, "application/xml");
}

function allText(el: Element | undefined): string {
  if (!el) return "";
  return Array.from(el.getElementsByTagName("t"))
    .map((t) => t.textContent ?? "")
    .join("");
}

/** "C12" → 2 */
function columnIndex(ref: string): number | null {
  const letters = /^[A-Z]+/.exec(ref)?.[0];
  if (!letters) return null;
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

type ZipEntry = { method: number; compressedSize: number; localOffset: number };

/** Reads the zip central directory: file name → where its data lives. */
function zipEntries(bytes: Uint8Array): Map<string, ZipEntry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("This file isn't a valid Excel workbook.");

  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const entries = new Map<string, ZipEntry>();
  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) break;
    const method = view.getUint16(p + 10, true);
    const compressedSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    entries.set(name, { method, compressedSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function inflateEntry(bytes: Uint8Array, e: ZipEntry): Promise<string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const nameLen = view.getUint16(e.localOffset + 26, true);
  const extraLen = view.getUint16(e.localOffset + 28, true);
  const start = e.localOffset + 30 + nameLen + extraLen;
  const data = bytes.slice(start, start + e.compressedSize);
  if (e.method === 0) return new TextDecoder().decode(data);
  if (e.method !== 8) throw new Error("Unsupported compression in this workbook.");
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).text();
}

// --- column matching -------------------------------------------------------

/** Finds the column for a field: exact header matches first, then partial
 *  ones, never reusing a column already taken (so "ITEM CODE" can't pass for
 *  the name, nor "CostPrice" for the selling price). */
export function findColumn(
  headers: string[],
  exact: string[],
  partial: string[],
  taken: Set<number>,
  exclude: string[] = [],
): number {
  const norm = headers.map((h) => h.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim());
  const ok = (i: number) => !taken.has(i) && !exclude.some((x) => norm[i].includes(x));
  for (const want of exact) {
    const i = norm.findIndex((h, idx) => h === want && ok(idx));
    if (i !== -1) return i;
  }
  for (const want of partial) {
    const i = norm.findIndex((h, idx) => h.includes(want) && ok(idx));
    if (i !== -1) return i;
  }
  return -1;
}

/** "KSh 1,234.50" → 1234.5 */
export function toNumber(value: string | undefined): number {
  const n = Number(String(value ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** Supplier lists rarely have a form column; the product name usually says. */
const FORM_RULES: [string, RegExp][] = [
  ["inhaler", /\b(INHALER|INH|EVOHALER|ACCUHALER|ROTACAP|TURBUHALER|NEBUL)/],
  ["injection", /\b(INJ|INJECTION|VIAL|AMP|AMPOULE|IV|I\.V|INFUSION|PRE-?FILLED)\b/],
  ["drops", /\b(DROPS?|DRP|E\/D|EYE|EAR|NASAL)\b/],
  ["suspension", /\b(SUSP|SUSPENSION)\b/],
  ["syrup", /\b(SYRUP|SYR|ELIXIR|LINCTUS|MIXTURE|ORAL SOLUTION|LIQUID|TONIC)\b/],
  ["ointment", /\b(OINT|OINTMENT)\b/],
  ["cream", /\b(CREAM|CRM|GEL|LOTION|BALM|EMULSION)\b/],
  ["sachet", /\b(SACHETS?|SACH|GRANULES|POWDER|ORS)\b/],
  ["capsule", /\b(CAPS?|CAPSULES?|SOFTGELS?)\b/],
  ["tablet", /\b(TABS?|TABLETS?|CAPLETS?|LOZENGES?)\b/],
];

export function guessForm(name: string): string {
  const upper = name.toUpperCase();
  return FORM_RULES.find(([, re]) => re.test(upper))?.[0] ?? "tablet";
}
