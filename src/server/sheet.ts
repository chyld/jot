// Spreadsheet workbook storage, validation and plain-text extraction.
// Spreadsheets are stored in notes.content as { type: 'sheet', version: 1, workbook }
// wrapping Univer's IWorkbookData JSON snapshot.
import { DEFAULT_FONT_FAMILY } from '../shared/constants';
import type { SheetDoc } from '../shared/types';
import { ContentError, isSafeHref } from './content';

export const MAX_SHEET_BYTES = 8 * 1024 * 1024;
export const MAX_SHEET_DEPTH = 24;
export const MAX_SHEETS = 50;
export const MAX_SHEET_ROWS = 100_000;
export const MAX_SHEET_COLS = 1_000;
export const MAX_BODY_TEXT = 200_000;
export const MAX_MCP_CHARS = 50_000;

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const STRIP_KEYS = new Set(['custom']);
const URL_KEYS = new Set(['url', 'href', 'src']);
const ALLOWED_RESOURCES = new Set([
  'SHEET_DEFINED_NAME_PLUGIN',
  'SHEET_RANGE_PROTECTION_PLUGIN',
  'SHEET_WORKSHEET_PROTECTION_PLUGIN',
  'SHEET_RANGE_THEME_MODEL_PLUGIN',
]);
const INTERNAL_SHEET_LINK = /^#gid=[\w-]+(?:&[\w=%:.,-]+)?$/;
const SCHEME_PREFIX = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

export function emptySheet(): SheetDoc {
  return {
    type: 'sheet',
    version: 1,
    workbook: {
      id: 'workbook',
      name: '',
      appVersion: '1.6.1',
      locale: 'enUS',
      styles: {},
      defaultStyle: { ff: DEFAULT_FONT_FAMILY },
      sheetOrder: ['sheet-1'],
      sheets: {
        'sheet-1': {
          id: 'sheet-1',
          name: 'Sheet1',
          rowCount: 100,
          columnCount: 26,
          defaultStyle: { ff: DEFAULT_FONT_FAMILY },
          cellData: {},
        },
      },
    },
  };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isSafeSheetUrl(v: string): boolean {
  const trimmed = v.trim();
  return INTERNAL_SHEET_LINK.test(trimmed) || isSafeHref(trimmed);
}

interface Budget {
  bytes: number;
}

function charge(budget: Budget, n: number) {
  budget.bytes += n;
  if (budget.bytes > MAX_SHEET_BYTES) {
    throw new ContentError('Spreadsheet is larger than the 8 MB limit.');
  }
}

function cleanValue(val: unknown, depth: number, budget: Budget): unknown {
  if (depth > MAX_SHEET_DEPTH) throw new ContentError('Spreadsheet data is nested too deeply.');
  if (val === null || typeof val === 'boolean') {
    charge(budget, 5);
    return val;
  }
  if (typeof val === 'string') {
    charge(budget, Buffer.byteLength(val, 'utf8') + 2);
    return val;
  }
  if (typeof val === 'number') {
    charge(budget, 8);
    return Number.isFinite(val) ? val : null;
  }
  if (Array.isArray(val)) {
    charge(budget, 2);
    const out: unknown[] = [];
    for (const item of val) {
      out.push(cleanValue(item, depth + 1, budget));
    }
    return out;
  }
  if (typeof val === 'object') {
    charge(budget, 2);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (FORBIDDEN_KEYS.has(k) || STRIP_KEYS.has(k) || v === undefined) continue;
      const lower = k.toLowerCase();
      if (URL_KEYS.has(lower)) {
        if (typeof v !== 'string' || !isSafeSheetUrl(v)) continue;
      } else if (lower === 'payload' && typeof v === 'string') {
        const t = v.trim();
        if ((SCHEME_PREFIX.test(t) || t.startsWith('#')) && !isSafeSheetUrl(t)) continue;
      }
      charge(budget, Buffer.byteLength(k, 'utf8') + 3);
      out[k] = cleanValue(v, depth + 1, budget);
    }
    return out;
  }
  return undefined;
}

function cleanResources(raw: unknown, budget: Budget): Array<{ name: string; data: string }> | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: Array<{ name: string; data: string }> = [];
  for (const item of raw) {
    if (!isPlainObject(item)) continue;
    const name = item.name;
    const data = item.data;
    if (typeof name !== 'string' || !ALLOWED_RESOURCES.has(name) || typeof data !== 'string') continue;
    charge(budget, Buffer.byteLength(name, 'utf8') + 16);
    try {
      const parsed = JSON.parse(data);
      const cleaned = cleanValue(parsed, 2, budget);
      const reserialized = JSON.stringify(cleaned);
      out.push({ name, data: reserialized });
    } catch (err) {
      if (err instanceof ContentError) throw err;
      // Drop malformed resource JSON rather than crashing the workbook.
    }
  }
  return out.length > 0 ? out : undefined;
}

function validateSheetEntry(sheet: unknown): Record<string, unknown> {
  if (!isPlainObject(sheet)) {
    throw new ContentError('Each worksheet must be an object.');
  }
  if (sheet.name !== undefined && typeof sheet.name !== 'string') {
    throw new ContentError('Worksheet name must be a string.');
  }
  if (sheet.id !== undefined && typeof sheet.id !== 'string') {
    throw new ContentError('Worksheet id must be a string.');
  }
  if (sheet.rowCount !== undefined) {
    if (typeof sheet.rowCount !== 'number' || !Number.isInteger(sheet.rowCount) || sheet.rowCount < 1 || sheet.rowCount > MAX_SHEET_ROWS) {
      throw new ContentError(`Worksheet rowCount must be between 1 and ${MAX_SHEET_ROWS}.`);
    }
  }
  if (sheet.columnCount !== undefined) {
    if (typeof sheet.columnCount !== 'number' || !Number.isInteger(sheet.columnCount) || sheet.columnCount < 1 || sheet.columnCount > MAX_SHEET_COLS) {
      throw new ContentError(`Worksheet columnCount must be between 1 and ${MAX_SHEET_COLS}.`);
    }
  }
  if (sheet.cellData !== undefined) {
    if (!isPlainObject(sheet.cellData)) {
      throw new ContentError('Worksheet cellData must be an object.');
    }
    for (const row of Object.values(sheet.cellData)) {
      if (!isPlainObject(row)) {
        throw new ContentError('Worksheet cellData rows must be objects.');
      }
    }
  }
  return sheet;
}

/** Validates and rebuilds a SheetDoc snapshot. Throws ContentError if invalid or oversized. */
export function sanitizeSheet(input: unknown): SheetDoc {
  if (!isPlainObject(input)) {
    throw new ContentError('Content must be a spreadsheet.');
  }
  if (input.type !== 'sheet' || input.version !== 1 || !isPlainObject(input.workbook)) {
    throw new ContentError('Content must be a spreadsheet.');
  }
  const wbRaw = input.workbook;
  if (!isPlainObject(wbRaw.sheets)) {
    throw new ContentError('Spreadsheet workbook has no sheets.');
  }

  // Depth-checked walk runs before JSON.stringify so deeply nested payloads return 400 (never RangeError).
  const budget: Budget = { bytes: 0 };
  const workbook: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(wbRaw)) {
    if (FORBIDDEN_KEYS.has(k) || STRIP_KEYS.has(k) || v === undefined) continue;
    if (k === 'resources') {
      const cleaned = cleanResources(v, budget);
      if (cleaned) workbook.resources = cleaned;
      continue;
    }
    workbook[k] = cleanValue(v, 1, budget);
  }

  if (!isPlainObject(workbook.sheets)) {
    throw new ContentError('Spreadsheet workbook has no sheets.');
  }
  const sheetIds = Object.keys(workbook.sheets);
  if (sheetIds.length === 0 || sheetIds.length > MAX_SHEETS) {
    throw new ContentError(`Spreadsheet must have between 1 and ${MAX_SHEETS} sheets.`);
  }
  for (const id of sheetIds) {
    validateSheetEntry(workbook.sheets[id]);
  }
  if (workbook.sheetOrder !== undefined) {
    if (!Array.isArray(workbook.sheetOrder)) {
      throw new ContentError('Spreadsheet sheetOrder must be an array.');
    }
    const validOrder: string[] = [];
    const seen = new Set<string>();
    for (const id of workbook.sheetOrder) {
      if (typeof id !== 'string' || !Object.hasOwn(workbook.sheets, id)) {
        throw new ContentError('Spreadsheet sheetOrder references an unknown sheet.');
      }
      if (!seen.has(id)) {
        seen.add(id);
        validOrder.push(id);
      }
    }
    workbook.sheetOrder = validOrder;
  }

  const finalBytes = Buffer.byteLength(JSON.stringify(workbook), 'utf8');
  if (finalBytes > MAX_SHEET_BYTES) {
    throw new ContentError('Spreadsheet is larger than the 8 MB limit.');
  }
  return { type: 'sheet', version: 1, workbook };
}

function cleanDisplayText(raw: string): string {
  // Strip Univer dataStream / ASCII control characters and collapse whitespace/newlines.
  return raw.replace(/[\x00-\x08\x0B-\x1F\x7F]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function cellDisplayText(cell: unknown): string {
  if (!isPlainObject(cell)) return '';
  if (typeof cell.v === 'string') {
    const t = cleanDisplayText(cell.v);
    if (t) return t;
  } else if (typeof cell.v === 'number' && Number.isFinite(cell.v)) {
    return String(cell.v);
  } else if (typeof cell.v === 'boolean') {
    return cell.v ? 'TRUE' : 'FALSE';
  }
  const p = cell.p as { body?: { dataStream?: unknown } } | undefined;
  if (p && typeof p.body?.dataStream === 'string') {
    const t = cleanDisplayText(p.body.dataStream);
    if (t) return t;
  }
  if (typeof cell.f === 'string') {
    const t = cleanDisplayText(cell.f);
    if (t) return t;
  }
  return '';
}

function orderedSheets(doc: SheetDoc): Array<Record<string, unknown>> {
  const wb = doc.workbook as { sheetOrder?: unknown; sheets?: Record<string, unknown> };
  const sheets = isPlainObject(wb.sheets) ? wb.sheets : {};
  const order = Array.isArray(wb.sheetOrder) ? wb.sheetOrder.filter((id): id is string => typeof id === 'string') : [];
  const seen = new Set<string>();
  const out: Array<Record<string, unknown>> = [];
  for (const id of [...order, ...Object.keys(sheets)]) {
    if (seen.has(id) || !Object.hasOwn(sheets, id)) continue;
    seen.add(id);
    const s = sheets[id];
    if (isPlainObject(s)) out.push(s);
  }
  return out;
}

/** Flattened plain text of populated cells across sheets (for FTS search and home previews). */
export function sheetText(doc: SheetDoc): string {
  const lines: string[] = [];
  let total = 0;
  for (const sheet of orderedSheets(doc)) {
    const cellData = sheet.cellData;
    if (!isPlainObject(cellData)) continue;
    const rowKeys = Object.keys(cellData).sort((a, b) => Number(a) - Number(b));
    for (const rk of rowKeys) {
      const row = cellData[rk];
      if (!isPlainObject(row)) continue;
      const colKeys = Object.keys(row).sort((a, b) => Number(a) - Number(b));
      const vals: string[] = [];
      for (const ck of colKeys) {
        const t = cellDisplayText(row[ck]);
        if (t) vals.push(t);
      }
      if (vals.length) {
        const line = vals.join(' ');
        lines.push(line);
        total += line.length + 1;
        if (total >= MAX_BODY_TEXT) return lines.join('\n').slice(0, MAX_BODY_TEXT);
      }
    }
  }
  return lines.join('\n');
}

/** True when no sheet contains any cell value, formula or rich-text content. */
export function isEmptySheet(doc: SheetDoc): boolean {
  for (const sheet of orderedSheets(doc)) {
    const cellData = sheet.cellData;
    if (!isPlainObject(cellData)) continue;
    for (const row of Object.values(cellData)) {
      if (!isPlainObject(row)) continue;
      for (const cell of Object.values(row)) {
        if (cellDisplayText(cell) !== '') return false;
      }
    }
  }
  return true;
}

/** Readable tab-separated rendering of a spreadsheet for MCP read_note, preserving columns and capping size. */
export function sheetToMarkdown(doc: SheetDoc): string {
  const sections: string[] = [];
  let total = 0;
  let truncated = false;
  for (const sheet of orderedSheets(doc)) {
    const name = typeof sheet.name === 'string' && sheet.name.trim() ? cleanDisplayText(sheet.name) : 'Sheet';
    const cellData = sheet.cellData;
    const rows: string[] = [];
    if (isPlainObject(cellData)) {
      const rowKeys = Object.keys(cellData).sort((a, b) => Number(a) - Number(b));
      for (const rk of rowKeys) {
        const row = cellData[rk];
        if (!isPlainObject(row)) continue;
        const entries: Array<[number, string]> = [];
        for (const [ck, cell] of Object.entries(row)) {
          const idx = Number(ck);
          if (!Number.isInteger(idx) || idx < 0 || idx >= MAX_SHEET_COLS) continue;
          const text = cellDisplayText(cell);
          if (text) entries.push([idx, text]);
        }
        if (!entries.length) continue;
        entries.sort((a, b) => a[0] - b[0]);
        const maxCol = entries[entries.length - 1][0];
        const cells = Array<string>(maxCol + 1).fill('');
        for (const [idx, text] of entries) cells[idx] = text;
        const rowNum = Number.isInteger(Number(rk)) ? Number(rk) + 1 : rk;
        const line = `${rowNum}\t${cells.join('\t')}`;
        if (total + line.length + 1 > MAX_MCP_CHARS) {
          truncated = true;
          break;
        }
        rows.push(line);
        total += line.length + 1;
      }
    }
    const header = `## ${name}\n`;
    const body = rows.length ? rows.join('\n') : '(empty)';
    sections.push(header + body);
    total += header.length + 2;
    if (truncated) break;
  }
  const out = sections.join('\n\n');
  return truncated ? `${out}\n\n… (truncated at ${MAX_MCP_CHARS} characters)` : out;
}
