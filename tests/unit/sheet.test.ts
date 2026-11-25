// Type 3 (unit): spreadsheet snapshot validation, plain-text extraction, and empty checks.
import { describe, expect, it } from 'vitest';
import { ContentError } from '../../src/server/content';
import {
  emptySheet,
  isEmptySheet,
  MAX_MCP_CHARS,
  MAX_SHEET_BYTES,
  MAX_SHEET_COLS,
  MAX_SHEET_DEPTH,
  MAX_SHEET_ROWS,
  MAX_SHEETS,
  sanitizeSheet,
  sheetText,
  sheetToMarkdown,
} from '../../src/server/sheet';

describe('spreadsheet helpers', () => {
  it('creates a valid empty workbook and recognises it as empty', () => {
    const s = emptySheet();
    expect(s.type).toBe('sheet');
    expect(s.version).toBe(1);
    expect(sanitizeSheet(s)).toEqual(s);
    expect(isEmptySheet(s)).toBe(true);
    expect(sheetText(s)).toBe('');
  });

  it('extracts cell values, rich text, and formulas cleanly for search, previews, and MCP', () => {
    const s = emptySheet();
    (s.workbook.sheets as any)['sheet-1'].cellData = {
      '1': { '0': { v: 'Total' }, '2': { v: 42, f: '=SUM(C1:C1)' } },
      '0': { '0': { v: 'Item\nName' }, '2': { v: 'Amount' } },
      '2': { '0': { v: '', f: '=1+1' }, '1': { v: '', p: { body: { dataStream: 'Rich\x1EText\r\n' } } } },
    };
    expect(isEmptySheet(s)).toBe(false);
    expect(sheetText(s)).toBe('Item Name Amount\nTotal 42\n=1+1 Rich Text');
    const md = sheetToMarkdown(s);
    expect(md).toContain('## Sheet1');
    // Sparse column 1 stays empty (two tabs between col 0 and col 2) so values never shift left.
    expect(md).toContain('1\tItem Name\t\tAmount');
    expect(md).toContain('2\tTotal\t\t42');
    expect(md).toContain('3\t=1+1\tRich Text');
  });

  it('recognises formula-only and rich-text-only cells with v: "" as non-empty', () => {
    const formulaOnly = emptySheet();
    (formulaOnly.workbook.sheets as any)['sheet-1'].cellData = { '0': { '0': { v: '', f: '=SUM(A2:A5)' } } };
    expect(isEmptySheet(formulaOnly)).toBe(false);
    expect(sheetText(formulaOnly)).toBe('=SUM(A2:A5)');

    const richOnly = emptySheet();
    (richOnly.workbook.sheets as any)['sheet-1'].cellData = { '0': { '0': { v: '   ', p: { body: { dataStream: 'Hello\r\n' } } } } };
    expect(isEmptySheet(richOnly)).toBe(false);
    expect(sheetText(richOnly)).toBe('Hello');
  });

  it('rejects non-sheet payloads, malformed sheets, out-of-bounds dimensions, and invalid sheetOrder', () => {
    expect(() => sanitizeSheet({ type: 'doc', content: [] })).toThrow(ContentError);
    expect(() => sanitizeSheet({ type: 'sheet', version: 2, workbook: { sheets: { a: {} } } })).toThrow(ContentError);
    expect(() => sanitizeSheet({ type: 'sheet', version: 1, workbook: { sheets: {} } })).toThrow(ContentError);
    expect(() => sanitizeSheet({ type: 'sheet', version: 1, workbook: { sheets: { 'sheet-1': 'nope' } } })).toThrow(ContentError);
    expect(() => sanitizeSheet({ type: 'sheet', version: 1, workbook: { sheets: { 'sheet-1': null } } })).toThrow(ContentError);
    expect(() => sanitizeSheet({ type: 'sheet', version: 1, workbook: { sheets: { 'sheet-1': { rowCount: MAX_SHEET_ROWS + 1 } } } })).toThrow(ContentError);
    expect(() => sanitizeSheet({ type: 'sheet', version: 1, workbook: { sheets: { 'sheet-1': { rowCount: 0 } } } })).toThrow(ContentError);
    expect(() => sanitizeSheet({ type: 'sheet', version: 1, workbook: { sheets: { 'sheet-1': { columnCount: MAX_SHEET_COLS + 1 } } } })).toThrow(ContentError);
    expect(() => sanitizeSheet({ type: 'sheet', version: 1, workbook: { sheets: { 'sheet-1': { cellData: 'bad' } } } })).toThrow(ContentError);
    expect(() => sanitizeSheet({ type: 'sheet', version: 1, workbook: { sheets: { 'sheet-1': { cellData: { '0': 'bad' } } } } })).toThrow(ContentError);
    expect(() =>
      sanitizeSheet({ type: 'sheet', version: 1, workbook: { sheetOrder: ['missing'], sheets: { 'sheet-1': { cellData: {} } } } }),
    ).toThrow(ContentError);
  });

  it('strips prototype keys (rejecting 0-sheet proto workbooks), custom fields, and unsafe URLs while keeping safe resources', () => {
    // A sheets object containing only __proto__ has 0 real sheets after cleaning and must be rejected.
    const protoOnly = JSON.parse('{"type":"sheet","version":1,"workbook":{"sheets":{"__proto__":{}}}}');
    expect(() => sanitizeSheet(protoOnly)).toThrow(ContentError);

    // sheetOrder referencing __proto__ must be rejected (and never hit Object.prototype).
    const protoOrder = JSON.parse('{"type":"sheet","version":1,"workbook":{"sheetOrder":["__proto__"],"sheets":{"s1":{"cellData":{}}}}}');
    expect(() => sanitizeSheet(protoOrder)).toThrow(ContentError);

    const payload = JSON.parse(
      `{
        "type": "sheet",
        "version": 1,
        "workbook": {
          "__proto__": { "polluted": true },
          "constructor": { "bad": true },
          "custom": { "x": 1 },
          "resources": [
            { "name": "evil", "data": "{}" },
            { "name": "SHEET_DEFINED_NAME_PLUGIN", "data": "{\\"d1\\":{\\"name\\":\\"Tax\\",\\"__proto__\\":{\\"x\\":1}}}" }
          ],
          "sheets": {
            "sheet-1": {
              "id": "sheet-1",
              "name": "Sheet1",
              "custom": { "sheetCustom": 1 },
              "cellData": {
                "0": {
                  "0": {
                    "v": "ok",
                    "custom": { "cellCustom": 1 },
                    "linkBad": { "url": "javascript:alert(1)" },
                    "linkArr": { "url": ["javascript:alert(1)"] },
                    "linkHref": { "href": "data:text/html,hi" },
                    "linkPayloadBad": { "payload": "javascript:alert(1)" },
                    "linkGood": { "url": "https://example.com" },
                    "linkInternal": { "url": "#gid=sheet-1&range=A1" },
                    "linkPayloadInternal": { "payload": "#gid=sheet-1&range=B2" }
                  }
                }
              }
            }
          }
        }
      }`,
    );
    const clean = sanitizeSheet(payload);
    expect(({} as any).polluted).toBeUndefined();
    expect(Object.hasOwn(clean.workbook, 'constructor')).toBe(false);
    expect((clean.workbook as any).custom).toBeUndefined();
    expect((clean.workbook as any).resources).toHaveLength(1);
    expect((clean.workbook as any).resources[0].name).toBe('SHEET_DEFINED_NAME_PLUGIN');
    expect((clean.workbook as any).resources[0].data).not.toContain('__proto__');

    const sheet = (clean.workbook.sheets as any)['sheet-1'];
    expect(sheet.custom).toBeUndefined();
    const cell = sheet.cellData['0']['0'];
    expect(cell.custom).toBeUndefined();
    expect(cell.linkBad.url).toBeUndefined();
    expect(cell.linkArr.url).toBeUndefined();
    expect(cell.linkHref.href).toBeUndefined();
    expect(cell.linkPayloadBad.payload).toBeUndefined();
    expect(cell.linkGood.url).toBe('https://example.com');
    expect(cell.linkInternal.url).toBe('#gid=sheet-1&range=A1');
    expect(cell.linkPayloadInternal.payload).toBe('#gid=sheet-1&range=B2');
  });

  it('enforces sheet count, nesting depth (as ContentError), byte size, and MCP output caps', () => {
    const tooMany: Record<string, unknown> = {};
    for (let i = 0; i <= MAX_SHEETS; i++) tooMany[`s${i}`] = { id: `s${i}`, cellData: {} };
    expect(() => sanitizeSheet({ type: 'sheet', version: 1, workbook: { sheets: tooMany } })).toThrow(ContentError);

    let deep: any = { v: 'x' };
    for (let i = 0; i < MAX_SHEET_DEPTH + 5; i++) deep = { nested: deep };
    expect(() =>
      sanitizeSheet({ type: 'sheet', version: 1, workbook: { sheets: { s1: { cellData: { '0': { '0': deep } } } } } }),
    ).toThrow(ContentError);

    const huge = emptySheet();
    (huge.workbook.sheets as any)['sheet-1'].cellData = { '0': { '0': { v: 'a'.repeat(MAX_SHEET_BYTES + 100) } } };
    expect(() => sanitizeSheet(huge)).toThrow(ContentError);

    const bigMcp = emptySheet();
    const rows: Record<string, unknown> = {};
    for (let r = 0; r < 600; r++) rows[String(r)] = { '0': { v: 'x'.repeat(120) } };
    (bigMcp.workbook.sheets as any)['sheet-1'].cellData = rows;
    const md = sheetToMarkdown(bigMcp);
    expect(md.length).toBeLessThanOrEqual(MAX_MCP_CHARS + 200);
    expect(md).toContain('truncated');
  });
});
