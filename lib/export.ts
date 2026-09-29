// CSV export helpers, shared by the reports and accounting pages.
//
// Deliberately dependency-free: a workbook library would be a big download for
// what is, in the end, a string join. Excel opens these directly — the UTF-8
// BOM below is what stops it mangling patient names and the "KSh" sign.

/** One column of an exportable table: a header and how to read it off a row. */
export interface Column<T> {
  header: string;
  value: (row: T) => string | number | null | undefined;
}

/** A table already rendered to CSV, ready to be stacked into a full export. */
export interface CsvSection {
  title: string;
  csv: string;
}

/**
 * Quote a single cell. Two things matter here:
 *  - RFC-4180 quoting so commas, quotes and newlines survive the round trip.
 *  - Spreadsheet formula injection: a cell opening with = + - @ is executed by
 *    Excel/Sheets when the file is opened, so it gets a leading apostrophe.
 */
function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/["\,\n\r]/.test(text)) text = `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** Render one table as CSV text (no BOM — see {@link downloadCsv}). */
export function toCsv<T>(columns: Column<T>[], rows: T[]): string {
  const lines = [columns.map((c) => cell(c.header)).join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => cell(c.value(row))).join(","));
  }
  return lines.join("\r\n");
}

/** Render one table and tag it with a title, for {@link sectionsToCsv}. */
export function section<T>(
  title: string,
  columns: Column<T>[],
  rows: T[],
): CsvSection {
  return { title, csv: toCsv(columns, rows) };
}

/**
 * Stack several tables into one CSV, each under its own title row and
 * separated by a blank line. Excel shows it as a single sheet with headings —
 * the pragmatic stand-in for a multi-sheet workbook.
 */
export function sectionsToCsv(
  sections: CsvSection[],
  meta: string[] = [],
): string {
  const blocks: string[] = [];
  if (meta.length) blocks.push(meta.map((line) => cell(line)).join("\r\n"));
  for (const s of sections) blocks.push([cell(s.title), s.csv].join("\r\n"));
  return blocks.join("\r\n\r\n");
}

/** Save CSV text to the user's machine as `filename`. */
export function downloadCsv(filename: string, csv: string) {
  // The BOM is what makes Excel read the file as UTF-8 rather than Latin-1.
  const blob = new Blob(["\uFEFF" + csv], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A filesystem-safe stamp for export filenames, e.g. "2026-09-02_1431". */
export function fileStamp(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `_${pad(d.getHours())}${pad(d.getMinutes())}`
  );
}

/** ISO timestamp → "2 Sep 2026, 14:31" for human-readable export columns. */
export function exportDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-KE", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** ISO timestamp → "2026-09-02", the form spreadsheets sort correctly. */
export function exportDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
