import { apiRequest, ApiError } from "./api";

/** The delimiter of a CSV file: a comma, a semicolon (Russian Excel) or a tab. */
export type CsvDelimiter = "," | ";" | "\t";

export interface CsvExportOptions {
  /** The name of the saved file. */
  filename?: string;
  /** The columns to write, in order; every key of the rows when empty. */
  columns?: string[];
  delimiter?: CsvDelimiter;
  /** The most rows to read; the rest are left out. */
  maxRows?: number;
}

export interface CsvImportOptions {
  /** The columns taken from the file; every column when empty. Others are ignored. */
  columns?: string[];
  /** Read from the first line when left out. */
  delimiter?: CsvDelimiter;
  /** The most rows to create; the file is refused when it has more. */
  maxRows?: number;
  /** Shows the result in a dialog; true unless set to false. A `csv-import` event with the report is sent either way. */
  notify?: boolean;
}

export interface CsvImportReport {
  /** The rows of the file, not counting the header. */
  total: number;
  created: number;
  /** One entry per refused row: its line in the file (the header is line 1) and the backend's reason. */
  failed: { row: number; message: string }[];
}

const PAGE_SIZE = 500;
const DEFAULT_MAX_ROWS = 50000;
const DEFAULT_MAX_IMPORT_ROWS = 5000;

/** Splits CSV text into rows of cells: quotes may hold delimiters, line breaks and doubled quotes. */
export function parseCsv(text: string, delimiter: CsvDelimiter): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let index = 0; index < source.length; index++) {
    const char = source[index]!;
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          cell += '"';
          index++;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index++;
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
    } else {
      cell += char;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((value) => value.trim() !== ""));
}

/** The delimiter the first line of a file uses: the one of the three it holds most outside quotes. */
export function detectDelimiter(text: string): CsvDelimiter {
  const firstLine = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).split(/\r?\n/, 1)[0] ?? "";
  const counts: Record<CsvDelimiter, number> = { ",": 0, ";": 0, "\t": 0 };
  let quoted = false;
  for (const char of firstLine) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && char in counts) counts[char as CsvDelimiter]++;
  }
  const best = (Object.keys(counts) as CsvDelimiter[]).reduce((a, b) => (counts[b] > counts[a] ? b : a));
  return counts[best] > 0 ? best : ",";
}

/** One cell as text: a formula-looking text is defused, a value with a delimiter, quote or line break is quoted. */
function formatCell(value: unknown, delimiter: CsvDelimiter): string {
  if (value === null || value === undefined) return "";
  let text = typeof value === "object" ? JSON.stringify(value) : String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return /["\r\n]/.test(text) || text.includes(delimiter) || /^\s|\s$/.test(text)
    ? '"' + text.replace(/"/g, '""') + '"'
    : text;
}

/** CSV text for the rows: a header line of the columns, then one line per row. */
export function formatCsv(
  rows: Record<string, unknown>[],
  columns: string[],
  delimiter: CsvDelimiter = ",",
): string {
  const keys = columns.length > 0 ? columns : Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const lines = [keys.map((key) => formatCell(key, delimiter)).join(delimiter)];
  for (const row of rows) lines.push(keys.map((key) => formatCell(row[key], delimiter)).join(delimiter));
  return lines.join("\r\n") + "\r\n";
}

/** Every row of a list route, a page at a time. */
export async function readAllRows(path: string, maxRows = DEFAULT_MAX_ROWS): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  const separator = path.includes("?") ? "&" : "?";
  while (rows.length < maxRows) {
    const page = await apiRequest<unknown>(`${path}${separator}limit=${PAGE_SIZE}&offset=${rows.length}`);
    if (!Array.isArray(page)) throw new Error("The address does not answer with a list of records.");
    rows.push(...(page as Record<string, unknown>[]));
    if (page.length < PAGE_SIZE) break;
  }
  return rows.slice(0, maxRows);
}

/** Saves `text` as a file the browser downloads. */
function saveFile(text: string, filename: string): void {
  const url = URL.createObjectURL(new Blob(["\uFEFF", text], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** Reads every row of the list route `path` and downloads them as a CSV file. */
export async function exportCsv(path: string, options: CsvExportOptions = {}): Promise<void> {
  const rows = await readAllRows(path, options.maxRows);
  saveFile(formatCsv(rows, options.columns ?? [], options.delimiter ?? ","), options.filename || "export.csv");
}

/** What a button calls: exports, and tells the person in a dialog when the rows could not be read. */
export function downloadCsv(path: string, options: CsvExportOptions = {}): void {
  void exportCsv(path, options).catch((error: unknown) => window.alert(reason(error)));
}

/** A cell as the JSON value it most likely is: a number, `true`/`false`, or the text; an empty cell is left out. */
export function typedValue(cell: string): unknown {
  const text = cell.trim();
  if (/^-?(0|[1-9]\d*)(\.\d+)?$/.test(text)) return Number(text);
  if (text === "true" || text === "false") return text === "true";
  return cell;
}

/** Why a request was refused, in a line. */
export function reason(error: unknown): string {
  if (error instanceof ApiError) return `${error.status}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

/** One filled cell of an imported row: the JSON value it most likely is, and its text for a backend that wants text. */
export interface ImportCell {
  typed: unknown;
  plain: string;
}

/**
 * Creates one record per row, a row at a time. `header` names the columns; a row is a list of cells
 * (`null` for an empty one), and a row with no filled cell is skipped. A cell goes as a number or a
 * boolean when it reads as one; a backend that wants it as text (a code like "007" is kept as it is,
 * but "42" in a text column is not) refuses the row with a 400 or 422, and the row is sent again with
 * every cell as text before it counts as failed. A row is reported by its line in the file (the
 * header is line 1).
 */
export async function importRows(
  path: string,
  header: string[],
  lines: (ImportCell | null)[][],
  options: Pick<CsvImportOptions, "columns" | "maxRows"> = {},
): Promise<CsvImportReport> {
  const filled = lines.filter((cells) => cells.some((cell) => cell !== null));
  const report: CsvImportReport = { total: filled.length, created: 0, failed: [] };
  const maxRows = options.maxRows ?? DEFAULT_MAX_IMPORT_ROWS;
  if (filled.length > maxRows) {
    report.failed.push({ row: 1, message: `The file has ${filled.length} rows; at most ${maxRows} can be imported at once.` });
    return report;
  }
  const names = header.map((name) => name.trim());
  const wanted = options.columns && options.columns.length > 0 ? new Set(options.columns) : undefined;
  for (const [index, cells] of lines.entries()) {
    if (!cells.some((cell) => cell !== null)) continue;
    const typed: Record<string, unknown> = {};
    const plain: Record<string, unknown> = {};
    names.forEach((name, column) => {
      const cell = cells[column] ?? null;
      if (name === "" || cell === null || (wanted && !wanted.has(name))) return;
      typed[name] = cell.typed;
      plain[name] = cell.plain;
    });
    try {
      await apiRequest(path, { method: "POST", json: typed });
      report.created++;
    } catch (error) {
      const retriable = error instanceof ApiError && (error.status === 400 || error.status === 422);
      try {
        if (!retriable) throw error;
        await apiRequest(path, { method: "POST", json: plain });
        report.created++;
      } catch (second) {
        report.failed.push({ row: index + 2, message: reason(retriable ? second : error) });
      }
    }
  }
  return report;
}

/** Creates one record per row of the CSV `text` (see `importRows`). */
export async function importCsv(path: string, text: string, options: CsvImportOptions = {}): Promise<CsvImportReport> {
  const delimiter = options.delimiter ?? detectDelimiter(text);
  const [header, ...lines] = parseCsv(text, delimiter);
  if (!header) return { total: 0, created: 0, failed: [] };
  const cells = lines.map((row) => row.map((cell) => (cell === "" ? null : { typed: typedValue(cell), plain: cell })));
  return importRows(path, header, cells, options);
}

/** A sentence for the dialog: what was made and the first refused rows. */
export function summarizeImport(report: CsvImportReport): string {
  const lines = [`Imported ${report.created} of ${report.total} rows.`];
  for (const failure of report.failed.slice(0, 10)) lines.push(`Line ${failure.row}: ${failure.message}`);
  if (report.failed.length > 10) lines.push(`…and ${report.failed.length - 10} more.`);
  return lines.join("\n");
}

/** Asks the person for a CSV file, imports it and shows the report (and sends it as a `csv-import` event). */
export function pickAndImportCsv(path: string, options: CsvImportOptions = {}): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".csv,text/csv";
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;
    void file
      .text()
      .then((text) => importCsv(path, text, options))
      .then((report) => {
        window.dispatchEvent(new CustomEvent("csv-import", { detail: report }));
        if (options.notify !== false) window.alert(summarizeImport(report));
      })
      .catch((error: unknown) => {
        if (options.notify !== false) window.alert(reason(error));
      });
  };
  input.click();
}
