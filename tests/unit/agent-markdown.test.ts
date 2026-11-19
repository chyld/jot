// Type 3 (unit): Markdown <-> Jot documents for agent notes (agent-spec.md §5-§7).
import { describe, expect, it } from 'vitest';
import { docToMarkdown, markdownToDoc, noteTitle, TYPEWRITER, TYPEWRITER_HEADING } from '../../src/server/agent/markdown';
import { sanitizeDoc } from '../../src/server/content';

const TW = TYPEWRITER; // the Typewriter look on every piece of text
const tx = (text: string, ...marks: any[]) => ({ type: 'text', text, marks: [...marks, TW] });
// Heading text: the Typewriter font and colour, but no size, so Jot's heading sizes apply.
const hx = (text: string, ...marks: any[]) => ({ type: 'text', text, marks: [...marks, TYPEWRITER_HEADING] });
const para = (...content: any[]) => ({ type: 'paragraph', content });
const conv = (md: string, images = new Map<string, string>()) => markdownToDoc(md, images).doc as any;
const blocks = (md: string) => conv(md).content;

describe('Markdown to a note', () => {
  it('plain text becomes paragraphs in the Typewriter look (Fira Code 15 px, Jet)', () => {
    expect(TW).toEqual({ type: 'textStyle', attrs: { fontFamily: '"Fira Code"', fontSize: '15px', color: '#141414' } });
    expect(blocks('first line\n\nsecond one')).toEqual([para(tx('first line')), para(tx('second one'))]);
  });

  it('bold, italic and strikethrough', () => {
    expect(blocks('a **b** *c* ~~d~~')).toEqual([para(tx('a '), tx('b', { type: 'bold' }), tx(' '), tx('c', { type: 'italic' }), tx(' '), tx('d', { type: 'strike' }))]);
  });

  it('headings 1-3 (deeper ones become heading 3), in Fira Code and Jet with no font size of their own', () => {
    expect(TYPEWRITER_HEADING).toEqual({ type: 'textStyle', attrs: { fontFamily: '"Fira Code"', color: '#141414' } });
    const b = blocks('# One\n\n## Two **bold**\n\n### Three\n\n#### Four\n\n###### Six');
    expect(b.map((n: any) => n.attrs.level)).toEqual([1, 2, 3, 3, 3]);
    expect(b[0]).toEqual({ type: 'heading', attrs: { level: 1 }, content: [hx('One')] });
    expect(b[1].content).toEqual([hx('Two '), hx('bold', { type: 'bold' })]);
    expect(JSON.stringify(b)).not.toContain('fontSize');
  });

  it('bullet and numbered lists, nested', () => {
    const b = blocks('- one\n- two\n  1. inner\n  2. more\n\n3. three\n4. four');
    expect(b[0].type).toBe('bulletList');
    expect(b[0].content[1].content[1]).toEqual({
      type: 'orderedList',
      content: [{ type: 'listItem', content: [para(tx('inner'))] }, { type: 'listItem', content: [para(tx('more'))] }],
    });
    expect(b[1]).toMatchObject({ type: 'orderedList', attrs: { start: 3 } });
  });

  it('links for http, https and mailto only; any other link keeps its text', () => {
    const b = blocks('[a](https://e.com/x) [b](http://e.com) [c](mailto:me@e.com) [d](javascript:alert(1)) [e](ftp://e.com) [f](data:text/html,x) [g](/relative) [h](vbscript:x)');
    const runs = b[0].content;
    const link = (href: string) => ({ type: 'link', attrs: { href } });
    expect(runs.filter((r: any) => r.marks.some((m: any) => m.type === 'link')).map((r: any) => [r.text, r.marks[0]])).toEqual([
      ['a', link('https://e.com/x')],
      ['b', link('http://e.com')],
      ['c', link('mailto:me@e.com')],
    ]);
    const plain = runs.map((r: any) => r.text).join('');
    for (const w of ['d', 'e', 'f', 'g', 'h']) expect(plain).toContain(w);
    expect(JSON.stringify(b)).not.toMatch(/javascript|ftp:|data:|vbscript|relative/);
  });

  it('tables', () => {
    expect(blocks('| A | B |\n|---|---|\n| 1 | **2** |')).toEqual([
      {
        type: 'table',
        content: [
          { type: 'tableRow', content: [{ type: 'tableHeader', content: [para(tx('A'))] }, { type: 'tableHeader', content: [para(tx('B'))] }] },
          { type: 'tableRow', content: [{ type: 'tableCell', content: [para(tx('1'))] }, { type: 'tableCell', content: [para(tx('2', { type: 'bold' }))] }] },
        ],
      },
    ]);
  });

  it('inline code and fenced code (code blocks keep Jot’s code look)', () => {
    const b = blocks('use `npm test` now\n\n```js\nconst a = 1;\n```\n\n```\nplain\n```');
    expect(b[0].content[1]).toEqual(tx('npm test', { type: 'code' }));
    expect(b[1]).toEqual({ type: 'codeBlock', attrs: { language: 'js' }, content: [{ type: 'text', text: 'const a = 1;' }] });
    expect(b[2]).toEqual({ type: 'codeBlock', content: [{ type: 'text', text: 'plain' }] });
  });

  it('quotes and horizontal lines', () => {
    expect(blocks('> quoted **bit**\n\n---\n\nafter')).toEqual([
      { type: 'blockquote', content: [para(tx('quoted '), tx('bit', { type: 'bold' }))] },
      { type: 'horizontalRule' },
      para(tx('after')),
    ]);
  });

  it('everything else keeps its words and loses its markers', () => {
    const text = JSON.stringify(blocks('note[^1]\n\n[^1]: the footnote'));
    for (const w of ['note', 'the footnote']) expect(text).toContain(w);
  });

  it('task-list items keep their words and lose their [ ] and [x] markers', () => {
    const b = blocks('- [ ] task item\n- [x] done\n- [X] also done\n- plain [ ] item\n\n1. [ ] numbered');
    expect(b[0]).toEqual({
      type: 'bulletList',
      content: ['task item', 'done', 'also done', 'plain [ ] item'].map((t) => ({ type: 'listItem', content: [para(tx(t))] })),
    });
    expect(b[1].content[0]).toEqual({ type: 'listItem', content: [para(tx('numbered'))] });
    expect(JSON.stringify(b)).not.toMatch(/taskList|taskItem/);
    // Outside a list item, "[ ]" is just text.
    expect(blocks('[ ] not a list')).toEqual([para(tx('[ ] not a list'))]);
  });

  it('raw HTML and script arrive as literal text, never interpreted', () => {
    const b = blocks('<script>alert(1)</script>\n\nhi <b onclick="x()">bold?</b> <img src=x onerror=alert(2)>\n\n<div>block</div>');
    expect(b).toEqual([
      para(tx('<script>alert(1)</script>')),
      para(tx('hi <b onclick="x()">bold?</b> <img src=x onerror=alert(2)>')),
      para(tx('<div>block</div>')),
    ]);
  });

  it('images are placed by name; an unknown reference is dropped and its caption kept', () => {
    const images = new Map([['shot.png', '/api/photos/AAAAAAAAAAAAAAAAAAAAAA']]);
    const r = markdownToDoc('before\n\n![the shot](shot.png)\n\ntext ![missing pic](nope.png) and ![web](https://evil.example/x.png) after', images);
    expect(r.used).toEqual(new Set(['shot.png']));
    expect((r.doc as any).content).toEqual([
      para(tx('before')),
      { type: 'image', attrs: { src: '/api/photos/AAAAAAAAAAAAAAAAAAAAAA', alt: 'the shot' } },
      para(tx('text missing pic and web after')),
    ]);
  });

  it('an image inside a paragraph splits it around the photo', () => {
    const images = new Map([['a.png', '/api/photos/BBBBBBBBBBBBBBBBBBBBBB']]);
    expect(conv('left ![](a.png) right', images).content).toEqual([
      para(tx('left ')),
      { type: 'image', attrs: { src: '/api/photos/BBBBBBBBBBBBBBBBBBBBBB' } },
      para(tx(' right')),
    ]);
  });

  it('the stored note passes Jot’s sanitiser unchanged', () => {
    const md = [
      '# Title',
      'Some **bold** *it* ~~gone~~ `code` [link](https://e.com) <i>html</i>',
      '- a\n  - b\n1. c',
      '| x | y |\n|---|---|\n| 1 | 2 |',
      '> quote',
      '---',
      '```ts\nlet x = 1;\n```',
      '![pic](p.png)',
      'line one  \nline two',
    ].join('\n\n');
    const d = conv(md, new Map([['p.png', '/api/photos/CCCCCCCCCCCCCCCCCCCCCC']]));
    expect(JSON.stringify(sanitizeDoc(d))).toBe(JSON.stringify(d));
  });

  it('an empty note is one empty paragraph', () => {
    expect(conv('')).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
  });
});

describe('the title', () => {
  it('is the one given; otherwise the first heading; otherwise the first line of text', () => {
    expect(noteTitle('  Given  ', conv('# Heading\n\ntext'))).toBe('Given');
    expect(noteTitle(undefined, conv('intro text\n\n## The heading\n\nmore'))).toBe('The heading');
    expect(noteTitle('', conv('first line here\nsame paragraph\n\nnext'))).toBe('first line here same paragraph');
    expect(noteTitle(undefined, conv(''))).toBe('');
    expect(noteTitle('x'.repeat(600), conv('a')).length).toBe(500);
  });
});

describe('a note as Markdown', () => {
  it('uses the same features and drops what Markdown cannot express', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Head' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'big', marks: [{ type: 'textStyle', attrs: { fontFamily: '"Lora"', fontSize: '40px', color: '#E11D48' } }, { type: 'bold' }] },
            { type: 'text', text: ' under', marks: [{ type: 'underline' }, { type: 'highlight', attrs: { color: '#FFE38F' } }] },
            { type: 'text', text: ' it', marks: [{ type: 'italic' }] },
            { type: 'text', text: ' x', marks: [{ type: 'strike' }] },
            { type: 'text', text: ' c', marks: [{ type: 'code' }] },
            { type: 'text', text: ' site', marks: [{ type: 'link', attrs: { href: 'https://e.com' } }] },
          ],
        },
        { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }, { type: 'orderedList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'inner' }] }] }] }] }] },
        { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'done' }] }] }] },
        { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'q' }] }] },
        { type: 'codeBlock', attrs: { language: 'js' }, content: [{ type: 'text', text: 'let a;' }] },
        { type: 'horizontalRule' },
        { type: 'image', attrs: { src: '/api/photos/AAAAAAAAAAAAAAAAAAAAAA' } },
        { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }] }] }, { type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '1' }] }] }] }] },
      ],
    };
    expect(docToMarkdown(doc as any)).toBe(
      ['## Head', '**big** under *it* ~~x~~ `c` [site](https://e.com)', '- one\n  1. inner', '- done', '> q', '```js\nlet a;\n```', '---', '[photo]', '| A |\n| --- |\n| 1 |'].join('\n\n'),
    );
  });

  it('round-trips what a bot wrote', () => {
    const md = '# Title\n\nSome **bold** and *italic*, ~~gone~~ and `code`.\n\n- a\n- b\n\n> quote\n\n[link](https://e.com)';
    expect(docToMarkdown(conv(md))).toBe(md);
  });

  it('escapes text that would otherwise read as Markdown', () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '*not bold* and [not a link](x) # no' }] }] };
    expect(conv(docToMarkdown(doc as any)).content[0].content.map((t: any) => t.text).join('')).toBe('*not bold* and [not a link](x) # no');
  });
});
