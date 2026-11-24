// @vitest-environment jsdom
// Type 7 (component): inline code violet chip styling, code block reset, and how Tiptap
// nests textStyle and highlight marks around <code> in the real editor DOM.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { makeEditor } from './setup';

const css = readFileSync('src/client/styles.css', 'utf8'); // tests run from the project root
const codeRule = css.match(/\n\.note-body code \{([^}]*)\}/)?.[1] ?? '';
const coloredCodeRule = css.match(/\n\.note-body span\[style\*='color'\] code \{([^}]*)\}/)?.[1] ?? '';
const preCodeRule = css.match(/\n\.note-body pre code \{([^}]*)\}/)?.[1] ?? '';
const botCodeRule = css.match(/\n\.bot-address code[^{]*\{([^}]*)\}/)?.[1] ?? '';

describe('inline code chip', () => {
  it('styles .note-body code as a violet chip while keeping font family and size', () => {
    expect(codeRule).toContain('background: #f3e9ff');
    expect(codeRule).toContain('color: #7a1fd6');
    expect(codeRule).toContain('border: 1px solid #dcc2fb');
    expect(codeRule).toContain('border-radius: 5px');
    expect(codeRule).toContain('padding: 0.1em 0.4em');
    expect(codeRule).toContain("font-family: 'Fira Code', ui-monospace, monospace");
    expect(codeRule).toContain('font-size: 0.9em');
  });

  it('resets code blocks so pre code does not pick up the chip edge, radius, background or violet colour', () => {
    expect(preCodeRule).toContain('background: none');
    expect(preCodeRule).toContain('color: inherit');
    expect(preCodeRule).toContain('border: 0');
    expect(preCodeRule).toContain('border-radius: 0');
    expect(preCodeRule).toContain('padding: 0');
  });

  it('lets an enclosing text-colour span win over the default violet, and leaves other code elements and print alone', () => {
    expect(coloredCodeRule).toContain('color: inherit');
    expect(botCodeRule).not.toContain('#f3e9ff');
    expect(botCodeRule).not.toContain('#7a1fd6');
    expect(botCodeRule).not.toContain('#dcc2fb');
    const print = css.slice(css.lastIndexOf('@media print {'));
    expect(print).toContain('print-color-adjust: exact');
    expect(print).not.toMatch(/\.note-body code\b/);
  });

  it('nests textStyle outside <code> and highlight <mark> inside <code>, matching the colour-override selector only when a colour is set', () => {
    const editor = makeEditor({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'plain', marks: [{ type: 'code' }] },
            { type: 'text', text: ' ' },
            { type: 'text', text: 'crimson', marks: [{ type: 'code' }, { type: 'textStyle', attrs: { color: '#E00631' } }] },
            { type: 'text', text: ' ' },
            { type: 'text', text: 'font-only', marks: [{ type: 'code' }, { type: 'textStyle', attrs: { fontFamily: '"Lora"', fontSize: '18px' } }] },
            { type: 'text', text: ' ' },
            { type: 'text', text: 'lit', marks: [{ type: 'code' }, { type: 'highlight', attrs: { color: '#FFE58F' } }] },
          ],
        },
        { type: 'codeBlock', content: [{ type: 'text', text: 'const x = 1;' }] },
      ],
    });
    editor.view.dom.classList.add('note-body');

    const codes = [...editor.view.dom.querySelectorAll('p code')];
    expect(codes.map((c) => c.textContent)).toEqual(['plain', 'crimson', 'font-only', 'lit']);
    const [plain, crimson, fontOnly, lit] = codes;

    // textStyle wraps outside <code>; only the coloured span matches span[style*='color'] code.
    expect(crimson.parentElement?.tagName).toBe('SPAN');
    expect(crimson.matches(".note-body span[style*='color'] code")).toBe(true);
    expect(plain.matches(".note-body span[style*='color'] code")).toBe(false);
    expect(fontOnly.parentElement?.tagName).toBe('SPAN');
    expect(fontOnly.matches(".note-body span[style*='color'] code")).toBe(false);

    // highlight renders <mark> inside <code> with inline background-color and color: inherit.
    const mark = lit.querySelector('mark');
    expect(mark).not.toBeNull();
    expect(mark!.getAttribute('style')).toContain('background-color');
    expect(mark!.getAttribute('style')).toContain('color: inherit');

    // Code block renders <pre><code>.
    expect(editor.view.dom.querySelector('pre > code')?.textContent).toBe('const x = 1;');
  });
});
