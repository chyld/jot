// Type 3 (unit): whiteboard scene validation, plain-text extraction, empty checks, and MCP outline.
import { describe, expect, it } from 'vitest';
import { ContentError } from '../../src/server/content';
import {
  boardText,
  boardToMarkdown,
  emptyBoard,
  isEmptyBoard,
  MAX_BOARD_BYTES,
  MAX_BOARD_DEPTH,
  MAX_BOARD_ELEMENTS,
  MAX_MCP_CHARS,
  sanitizeBoard,
} from '../../src/server/board';

function rect(id: string, x: number, y: number, extra: Record<string, unknown> = {}) {
  return { id, type: 'rectangle', x, y, width: 120, height: 60, ...extra };
}

function textEl(id: string, x: number, y: number, text: string, extra: Record<string, unknown> = {}) {
  return { id, type: 'text', x, y, width: 100, height: 24, text, originalText: text, ...extra };
}

describe('whiteboard helpers', () => {
  it('creates a valid empty board and recognises it as empty', () => {
    const b = emptyBoard();
    expect(b.type).toBe('board');
    expect(b.version).toBe(1);
    expect(sanitizeBoard(b)).toEqual(b);
    expect(isEmptyBoard(b)).toBe(true);
    expect(boardText(b)).toBe('');
    expect(boardToMarkdown(b)).toBe('(empty)');
  });

  it('extracts text elements and frame names in reading order and formats MCP outlines with connections', () => {
    const b = emptyBoard();
    b.elements = [
      { id: 'f1', type: 'frame', x: 0, y: 0, width: 600, height: 400, name: 'Architecture' },
      rect('r2', 300, 100),
      textEl('t2', 310, 110, 'Database', { containerId: 'r2' }),
      rect('r1', 40, 100),
      textEl('t1', 50, 110, 'Web\nApp', { containerId: 'r1' }),
      textEl('t3', 40, 260, 'Standalone note'),
      {
        id: 'a1',
        type: 'arrow',
        x: 160,
        y: 130,
        startBinding: { elementId: 'r1' },
        endBinding: { elementId: 'r2' },
      },
      textEl('ta', 200, 120, 'SQL', { containerId: 'a1' }),
    ];

    expect(isEmptyBoard(b)).toBe(false);
    expect(boardText(b)).toBe('Architecture\nWeb App\nDatabase\nSQL\nStandalone note');

    const md = boardToMarkdown(b);
    expect(md).toContain('Whiteboard:');
    expect(md).toContain('1 frame');
    expect(md).toContain('2 shapes');
    expect(md).toContain('1 arrow');
    expect(md).toContain('- Frame: Architecture');
    expect(md).toContain('- [rectangle] Web App');
    expect(md).toContain('- [rectangle] Database');
    expect(md).toContain('- Standalone note');
    expect(md).toContain('- Web App --(SQL)--> Database');
  });

  it('recognises boards with non-text shapes as non-empty', () => {
    const b = emptyBoard();
    b.elements = [rect('r1', 10, 20)];
    expect(isEmptyBoard(b)).toBe(false);
    expect(boardText(b)).toBe('');
  });

  it('rejects non-board payloads and malformed elements', () => {
    expect(() => sanitizeBoard({ type: 'doc', content: [] })).toThrow(ContentError);
    expect(() => sanitizeBoard({ type: 'board', version: 2, elements: [] })).toThrow(ContentError);
    expect(() => sanitizeBoard({ type: 'board', version: 1, elements: 'bad' })).toThrow(ContentError);
    expect(() => sanitizeBoard({ type: 'board', version: 1, elements: [], appState: 'bad' })).toThrow(ContentError);
    expect(() => sanitizeBoard({ type: 'board', version: 1, elements: [], files: 'bad' })).toThrow(ContentError);
    expect(() => sanitizeBoard({ type: 'board', version: 1, elements: ['bad'] })).toThrow(ContentError);
    expect(() => sanitizeBoard({ type: 'board', version: 1, elements: [{ id: 'a', x: 0, y: 0 }] })).toThrow(ContentError);
    expect(() => sanitizeBoard({ type: 'board', version: 1, elements: [{ type: 'rectangle', x: 0, y: 0 }] })).toThrow(ContentError);
    expect(() => sanitizeBoard({ type: 'board', version: 1, elements: [{ id: 'a', type: 'rectangle', x: NaN, y: 0 }] })).toThrow(ContentError);
  });

  it('strips deleted elements, disallowed element types, prototype keys, customData, unsafe links, transient appState, and inline files', () => {
    const payload = JSON.parse(
      `{
        "type": "board",
        "version": 1,
        "elements": [
          {
            "id": "r1",
            "type": "rectangle",
            "x": 10,
            "y": 20,
            "__proto__": { "polluted": true },
            "constructor": { "bad": true },
            "customData": { "secret": 1 },
            "link": "javascript:alert(1)"
          },
          {
            "id": "r2",
            "type": "ellipse",
            "x": 50,
            "y": 60,
            "link": "https://example.com/diagram"
          },
          { "id": "del", "type": "rectangle", "x": 0, "y": 0, "isDeleted": true },
          { "id": "emb", "type": "embeddable", "x": 0, "y": 0, "link": "https://evil.example" },
          { "id": "ifr", "type": "iframe", "x": 0, "y": 0 },
          { "id": "img", "type": "image", "x": 0, "y": 0, "fileId": "f1" }
        ],
        "appState": {
          "viewBackgroundColor": "#f8fafc",
          "gridSize": 20,
          "gridModeEnabled": true,
          "collaborators": [{ "id": "x" }],
          "selectedElementIds": { "r1": true },
          "scrollX": 100
        },
        "files": {
          "f1": { "mimeType": "image/png", "dataURL": "data:image/png;base64,AAAA" }
        }
      }`,
    );

    const clean = sanitizeBoard(payload);
    expect(({} as any).polluted).toBeUndefined();
    expect(clean.elements).toHaveLength(2);
    expect(clean.elements[0].id).toBe('r1');
    expect(Object.hasOwn(clean.elements[0], 'constructor')).toBe(false);
    expect(clean.elements[0].customData).toBeUndefined();
    expect(clean.elements[0].link).toBeNull();
    expect(clean.elements[1].id).toBe('r2');
    expect(clean.elements[1].link).toBe('https://example.com/diagram');
    expect(clean.appState).toEqual({
      viewBackgroundColor: '#f8fafc',
      gridSize: 20,
      gridModeEnabled: true,
    });
    expect(clean.files).toEqual({});
  });

  it('enforces element count, nesting depth, byte size, and MCP output caps', () => {
    const tooMany = Array.from({ length: MAX_BOARD_ELEMENTS + 1 }, (_, i) => rect(`r${i}`, i, 0));
    expect(() => sanitizeBoard({ type: 'board', version: 1, elements: tooMany })).toThrow(ContentError);

    let deep: any = { v: 'x' };
    for (let i = 0; i < MAX_BOARD_DEPTH + 5; i++) deep = { nested: deep };
    expect(() =>
      sanitizeBoard({ type: 'board', version: 1, elements: [rect('r1', 0, 0, { extra: deep })] }),
    ).toThrow(ContentError);

    const huge = emptyBoard();
    huge.elements = [textEl('t1', 0, 0, 'a'.repeat(MAX_BOARD_BYTES + 100))];
    expect(() => sanitizeBoard(huge)).toThrow(ContentError);

    const bigMcp = emptyBoard();
    bigMcp.elements = Array.from({ length: 600 }, (_, i) => textEl(`t${i}`, 0, i * 20, 'x'.repeat(120)));
    const md = boardToMarkdown(bigMcp);
    expect(md.length).toBeLessThanOrEqual(MAX_MCP_CHARS + 200);
    expect(md).toContain('truncated');
  });
});
