// Spreadsheet workbook storage, validation and plain-text extraction.
// Spreadsheets are stored in notes.content as { type: 'sheet', version: 1, workbook }
// wrapping Univer's IWorkbookData JSON snapshot.
import type { SheetDoc } from '../shared/types';
import { ContentError, isSafeHref } from './content';

export const MAX_SHEET_BYTES = 8 * 1024 * 1024;
export const MAX_SHEET_DEPTH = 24;
export const MAX_SHEETS = 50;
const MAX_BODY_TEXT = 20_000;

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const STRIP_TOP_KEYS = new Set(['resources', 'custom']);

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
      sheetOrder: ['sheet-1'],
      sheets: {
        'sheet-1': {
          id: 'sheet-1',
          name: 'Sheet1',
          rowCount: 100,
          columnCount: 26,
          cellData: {},
        },
      },
    },
  };
}

function cleanValue(val: unknown, depth: number): unknown {
  if (depth > MAX_SHEET_DEPTH) throw new ContentError('Spreadsheet data is nested too deeply.');
  if (val === null || typeof val === 'boolean' || typeof val === 'string') return val;
  if (typeof val === 'number') return Number.isFinite(val) ? val : null;
  if (Array.isArray(val)) return val.map((item) => cleanValue(item, depth + 1));
  if (typeof val === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (FORBIDDEN_KEYS.has(k) || v === undefined) continue;
      if (k === 'url' && typeof v === 'string' && !isSafeHref(v)) continue;
      out[k] = cleanValue(v, depth + 1);
    }
    return out;
  }
  return undefined;
}

/** Validates and rebuilds a SheetDoc snapshot. Throws ContentError if invalid or oversized. */
export function sanitizeSheet(input: unknown): SheetDoc {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ContentError('Content must be a spreadsheet.');
  }
  const o = input as Record<string, unknown>;
  if (o.type !== 'sheet' || o.version !== 1 || !o.workbook || typeof o.workbook !== 'object' || Array.isArray(o.workbook)) {
    throw new ContentError('Content must be a spreadsheet.');
  }
  const rawBytes = Buffer.byteLength(JSON.stringify(o.workbook), 'utf8');
  if (rawBytes > MAX_SHEET_BYTES) {
    throw new ContentError('Spreadsheet is larger than the 8 MB limit.');
  }
  const wbRaw = o.workbook as Record<string, unknown>;
  if (!wbRaw.sheets || typeof wbRaw.sheets !== 'object' || Array.isArray(wbRaw.sheets)) {
    throw new ContentError('Spreadsheet workbook has no sheets.');
  }
  const sheetKeys = Object.keys(wbRaw.sheets as Record<string, unknown>);
  if (sheetKeys.length === 0 || sheetKeys.length > MAX_SHEETS) {
    throw new ContentError(`Spreadsheet must have between 1 and ${MAX_SHEETS} sheets.`);
  }
  const workbook: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(wbRaw)) {
    if (FORBIDDEN_KEYS.has(k) || STRIP_TOP_KEYS.has(k) || v === undefined) continue;
    workbook[k] = cleanValue(v, 1);
  }
  return { type: 'sheet', version: 1, workbook };
}

function cellDisplayText(cell: unknown): string {
  if (!cell || typeof cell !== 'object') return '';
  const c = cell as Record<string, unknown>;
  if (typeof c.v === 'string') return c.v.trim();
  if (typeof c.v === 'number' && Number.isFinite(c.v)) return String(c.v);
  if (typeof c.v === 'boolean') return c.v ? 'TRUE' : 'FALSE';
  const p = c.p as { body?: { dataStream?: unknown } } | undefined;
  if (p && typeof p.body?.dataStream === 'string') {
    return p.body.dataStream.replace(/[\r\n]+/g, ' ').trim();
  }
  if (typeof c.f === 'string' && c.f.trim()) return c.f.trim();
  return '';
}

function orderedSheets(doc: SheetDoc): Array<Record<string, unknown>> {
  const wb = doc.workbook as { sheetOrder?: unknown; sheets?: Record<string, unknown> };
  const sheets = wb.sheets ?? {};
  const order = Array.isArray(wb.sheetOrder) ? wb.sheetOrder.filter((id): id is string => typeof id === 'string') : [];
  const seen = new Set<string>();
  const out: Array<Record<string, unknown>> = [];
  for (const id of [...order, ...Object.keys(sheets)]) {
    if (seen.has(id)) continue;
    seen.add(id);
    const s = sheets[id];
    if (s && typeof s === 'object' && !Array.isArray(s)) out.push(s as Record<string, unknown>);
  }
  return out;
}

/** Flattened plain text of populated cells across sheets (for FTS search and home previews). */
export function sheetText(doc: SheetDoc): string {
  const lines: string[] = [];
  let total = 0;
  for (const sheet of orderedSheets(doc)) {
    const cellData = sheet.cellData;
    if (!cellData || typeof cellData !== 'object') continue;
    const rowKeys = Object.keys(cellData as Record<string, unknown>).sort((a, b) => Number(a) - Number(b));
    for (const rk of rowKeys) {
      const row = (cellData as Record<string, unknown>)[rk];
      if (!row || typeof row !== 'object') continue;
      const colKeys = Object.keys(row as Record<string, unknown>).sort((a, b) => Number(a) - Number(b));
      const vals: string[] = [];
      for (const ck of colKeys) {
        const t = cellDisplayText((row as Record<string, unknown>)[ck]);
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
    if (!cellData || typeof cellData !== 'object') continue;
    for (const row of Object.values(cellData as Record<string, unknown>)) {
      if (!row || typeof row !== 'object') continue;
      for (const cell of Object.values(row as Record<string, unknown>)) {
        if (cellDisplayText(cell) !== '') return false;
      }
    }
  }
  return true;
}

/** Readable plain-text rendering of a spreadsheet for MCP read_note. */
export function sheetToMarkdown(doc: SheetDoc): string {
  const sections: string[] = [];
  for (const sheet of orderedSheets(doc)) {
    const name = typeof sheet.name === 'string' && sheet.name.trim() ? sheet.name.trim() : 'Sheet';
    const cellData = sheet.cellData;
    const rows: string[] = [];
    if (cellData && typeof cellData === 'object') {
      const rowKeys = Object.keys(cellData as Record<string, unknown>).sort((a, b) => Number(a) - Number(b));
      for (const rk of rowKeys) {
        const row = (cellData as Record<string, unknown>)[rk];
        if (!row || typeof row !== 'object') continue;
        const colKeys = Object.keys(row as Record<string, unknown>).sort((a, b) => Number(a) - Number(b));
        const vals = colKeys.map((ck) => cellDisplayText((row as Record<string, unknown>)[ck])).filter(Boolean);
        if (vals.length) rows.push(vals.join('\t'));
      }
    }
    sections.push(`## ${name}\n${rows.length ? rows.join('\n') : '(empty)'}`);
  }
  return sections.join('\n\n');
}
