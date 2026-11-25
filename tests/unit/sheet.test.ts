// Type 3 (unit): spreadsheet snapshot validation, plain-text extraction, and empty checks.
import { describe, expect, it } from 'vitest';
import { ContentError } from '../../src/server/content';
import { emptySheet, isEmptySheet, sanitizeSheet, sheetText, sheetToMarkdown } from '../../src/server/sheet';

describe('spreadsheet helpers', () => {
  it('creates a valid empty workbook and recognises it as empty', () => {
    const s = emptySheet();
    expect(s.type).toBe('sheet');
    expect(s.version).toBe(1);
    expect(sanitizeSheet(s)).toEqual(s);
    expect(isEmptySheet(s)).toBe(true);
    expect(sheetText(s)).toBe('');
  });

  it('extracts cell values and formulas in row/column order for search and previews', () => {
    const s = emptySheet();
    (s.workbook.sheets as any)['sheet-1'].cellData = {
      '1': { '0': { v: 'Total' }, '1': { v: 42, f: '=SUM(B1:B1)' } },
      '0': { '0': { v: 'Item' }, '1': { v: 'Amount' } },
    };
    expect(isEmptySheet(s)).toBe(false);
    expect(sheetText(s)).toBe('Item Amount\nTotal 42');
    expect(sheetToMarkdown(s)).toContain('## Sheet1');
    expect(sheetToMarkdown(s)).toContain('Total\t42');
  });

  it('rejects non-sheet payloads, missing sheets, prototype keys, and unsafe urls', () => {
    expect(() => sanitizeSheet({ type: 'doc', content: [] })).toThrow(ContentError);
    expect(() => sanitizeSheet({ type: 'sheet', version: 2, workbook: { sheets: { a: {} } } })).toThrow(ContentError);
    expect(() => sanitizeSheet({ type: 'sheet', version: 1, workbook: { sheets: {} } })).toThrow(ContentError);

    const payload = JSON.parse(
      JSON.stringify({
        type: 'sheet',
        version: 1,
        workbook: {
          resources: [{ name: 'evil' }],
          custom: { x: 1 },
          sheets: {
            'sheet-1': {
              id: 'sheet-1',
              name: 'Sheet1',
              cellData: {
                '0': {
                  '0': {
                    v: 'ok',
                    linkBad: { url: 'javascript:alert(1)' },
                    linkGood: { url: 'https://example.com' },
                  },
                },
              },
            },
          },
        },
      }),
    );
    const clean = sanitizeSheet(payload);
    expect((clean.workbook as any).resources).toBeUndefined();
    expect((clean.workbook as any).custom).toBeUndefined();
    const cell = (clean.workbook.sheets as any)['sheet-1'].cellData['0']['0'];
    expect(cell.linkBad.url).toBeUndefined();
    expect(cell.linkGood.url).toBe('https://example.com');
  });
});
