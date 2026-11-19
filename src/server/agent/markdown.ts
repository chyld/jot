// Markdown <-> Jot notes for agent notes (agent-spec.md §6, §7).
//
// Markdown is parsed by markdown-it (raw HTML off, so HTML stays literal text) and its
// token stream is mapped onto Jot's document through an allow-list: anything not listed
// keeps its words and loses its markers. The result then goes through Jot's note
// sanitiser as every saved note does. All text gets the Typewriter look (Fira Code 15 px,
// Jet), stamped onto the text the way applying a style does; code blocks keep Jot's code
// look. Images are placed by name from the images the bot sent; nothing is ever fetched.
import MarkdownIt from 'markdown-it';
import type { Token } from 'markdown-it';
import { MAX_TITLE_LENGTH } from '../../shared/constants';
import { findPalette } from '../../shared/palette';
import type { TiptapDoc, TiptapNode } from '../../shared/types';
import { docText, isSafeHref } from '../content';

type Mark = NonNullable<TiptapNode['marks']>[number];

export const TYPEWRITER: Mark = {
  type: 'textStyle',
  attrs: { fontFamily: '"Fira Code"', fontSize: '15px', color: findPalette('Jet')!.text },
};

const md = new MarkdownIt('default', { html: false, linkify: false, typographer: false, breaks: false });
// Every link and image reaches the converter as written; it alone decides what is allowed.
md.validateLink = () => true;
md.normalizeLink = (url: string) => url;

const ALLOWED_LINK = /^(https?:\/\/|mailto:)/i;
const LANGUAGE = /^[A-Za-z0-9+#_-]{1,30}$/;

/** An inline piece: text (with marks), a line break, or a photo that splits its block. */
type Piece = TiptapNode | { image: TiptapNode };

function inlinePieces(tokens: Token[], images: Map<string, string>, used: Set<string>): Piece[] {
  const out: Piece[] = [];
  const marks: Array<Mark | null> = []; // null: an opened marker that adds no mark
  const text = (t: string, extra: Mark[] = []) => {
    if (!t) return;
    const ms = [...(marks.filter(Boolean) as Mark[]), ...extra, TYPEWRITER];
    const last = out[out.length - 1] as TiptapNode | undefined;
    if (last && 'type' in last && last.type === 'text' && JSON.stringify(last.marks) === JSON.stringify(ms)) last.text += t;
    else out.push({ type: 'text', text: t, marks: ms });
  };
  for (const tok of tokens) {
    switch (tok.type) {
      case 'text':
        text(tok.content);
        break;
      case 'softbreak':
        text(' ');
        break;
      case 'hardbreak':
        out.push({ type: 'hardBreak' });
        break;
      case 'code_inline':
        text(tok.content, [{ type: 'code' }]);
        break;
      case 'strong_open':
        marks.push({ type: 'bold' });
        break;
      case 'em_open':
        marks.push({ type: 'italic' });
        break;
      case 's_open':
        marks.push({ type: 'strike' });
        break;
      case 'link_open': {
        const href = String(tok.attrGet('href') ?? '').trim();
        marks.push(ALLOWED_LINK.test(href) && isSafeHref(href) ? { type: 'link', attrs: { href } } : null);
        break;
      }
      case 'strong_close':
      case 'em_close':
      case 's_close':
      case 'link_close':
        marks.pop();
        break;
      case 'image': {
        const name = String(tok.attrGet('src') ?? '');
        const caption = tok.children?.map((c) => c.content).join('') ?? tok.content;
        const src = images.get(name);
        if (src) {
          used.add(name);
          out.push({ image: { type: 'image', attrs: caption ? { src, alt: caption.slice(0, 500) } : { src } } });
        } else {
          text(caption); // an unknown reference: the caption stays as text
        }
        break;
      }
      default:
        // Anything else keeps its words and loses its markers.
        if (tok.content) text(tok.content);
        else if (tok.children) out.push(...inlinePieces(tok.children, images, used));
    }
  }
  return out;
}

/** Text runs and the photos among them, as blocks: paragraphs (or the given block type) split around photos. */
function textBlocks(pieces: Piece[], wrap: (content: TiptapNode[]) => TiptapNode): TiptapNode[] {
  const blocks: TiptapNode[] = [];
  let run: TiptapNode[] = [];
  const flush = () => {
    if (run.length) blocks.push(wrap(run));
    run = [];
  };
  for (const p of pieces) {
    if ('image' in p) {
      flush();
      blocks.push(p.image);
    } else run.push(p);
  }
  flush();
  return blocks;
}

const para = (content: TiptapNode[]): TiptapNode => ({ type: 'paragraph', content });

/** Converts block tokens from `start` until a token of type `close` (or the end). */
function blocks(tokens: Token[], start: number, close: string | null, images: Map<string, string>, used: Set<string>): [TiptapNode[], number] {
  const out: TiptapNode[] = [];
  let i = start;
  while (i < tokens.length) {
    const tok = tokens[i];
    if (close && tok.type === close) return [out, i + 1];
    switch (tok.type) {
      case 'paragraph_open': {
        const inline = tokens[i + 1];
        out.push(...textBlocks(inlinePieces(inline.children ?? [], images, used), para));
        i += 3;
        continue;
      }
      case 'heading_open': {
        const level = Math.min(3, Number(tok.tag.slice(1)) || 1);
        const inline = tokens[i + 1];
        out.push(...textBlocks(inlinePieces(inline.children ?? [], images, used), (content) => ({ type: 'heading', attrs: { level }, content })));
        i += 3;
        continue;
      }
      case 'bullet_list_open':
      case 'ordered_list_open': {
        const ordered = tok.type === 'ordered_list_open';
        const items: TiptapNode[] = [];
        i++;
        while (i < tokens.length && tokens[i].type === 'list_item_open') {
          const [content, next] = blocks(tokens, i + 1, 'list_item_close', images, used);
          items.push({ type: 'listItem', content: content.length ? content : [{ type: 'paragraph' }] });
          i = next;
        }
        i++; // the list's close
        const start = ordered ? Number(tok.attrGet('start') ?? 1) : 1;
        if (items.length) out.push(ordered ? { type: 'orderedList', ...(start !== 1 ? { attrs: { start } } : {}), content: items } : { type: 'bulletList', content: items });
        continue;
      }
      case 'blockquote_open': {
        const [content, next] = blocks(tokens, i + 1, 'blockquote_close', images, used);
        out.push({ type: 'blockquote', content: content.length ? content : [{ type: 'paragraph' }] });
        i = next;
        continue;
      }
      case 'fence':
      case 'code_block': {
        const language = (tok.info ?? '').trim().split(/\s+/)[0];
        const code = tok.content.replace(/\n$/, '');
        out.push({ type: 'codeBlock', ...(LANGUAGE.test(language) ? { attrs: { language } } : {}), ...(code ? { content: [{ type: 'text', text: code }] } : {}) });
        i++;
        continue;
      }
      case 'hr':
        out.push({ type: 'horizontalRule' });
        i++;
        continue;
      case 'table_open': {
        const rows: TiptapNode[] = [];
        let cells: TiptapNode[] = [];
        i++;
        while (i < tokens.length && tokens[i].type !== 'table_close') {
          const t = tokens[i];
          if (t.type === 'tr_open') cells = [];
          else if (t.type === 'tr_close') rows.push({ type: 'tableRow', content: cells });
          else if (t.type === 'th_open' || t.type === 'td_open') {
            const content = textBlocks(inlinePieces(tokens[i + 1].children ?? [], images, used), para);
            cells.push({ type: t.type === 'th_open' ? 'tableHeader' : 'tableCell', content: content.length ? content : [{ type: 'paragraph' }] });
            i += 3;
            continue;
          }
          i++;
        }
        i++;
        if (rows.length) out.push({ type: 'table', content: rows });
        continue;
      }
      case 'inline':
        out.push(...textBlocks(inlinePieces(tok.children ?? [], images, used), para));
        i++;
        continue;
      default:
        // Any other block keeps its words.
        if (tok.content && tok.nesting === 0) out.push(...textBlocks(inlinePieces([{ type: 'text', content: tok.content } as Token], images, used), para));
        i++;
    }
  }
  return [out, i];
}

/** Converts a bot's Markdown into a note. `images` maps an image's name to its photo address. */
export function markdownToDoc(markdown: string, images: Map<string, string>): { doc: TiptapDoc; used: Set<string> } {
  const used = new Set<string>();
  const [content] = blocks(md.parse(markdown, {}), 0, null, images, used);
  return { doc: { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] }, used };
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/g;
const clip = (s: string) => s.replace(CONTROL, ' ').trim().slice(0, MAX_TITLE_LENGTH);

/** The title given; otherwise the first heading; otherwise the first line of text. */
export function noteTitle(given: string | undefined, doc: TiptapDoc): string {
  if (given && given.trim()) return clip(given);
  const heading = doc.content?.find((n) => n.type === 'heading');
  if (heading) return clip(docText(heading));
  return clip(docText(doc).split('\n')[0] ?? '');
}

// ------------------------------------------------------------------ a note as Markdown

const ESCAPE = /[\\`*_[\]~]/g;
function escapeText(t: string): string {
  return t.replace(ESCAPE, (c) => `\\${c}`);
}
/** Text at the start of a line that Markdown would read as a block marker. */
function escapeLineStart(s: string): string {
  return s.replace(/^(\s*)([#>+-]|\d+[.)])(?=\s|$)/, (_m, sp, mark) => `${sp}${mark.replace(/^(\d+)([.)])$/, '$1\\$2').replace(/^([#>+-])$/, '\\$1')}`);
}

interface Run {
  text: string;
  bold: boolean;
  italic: boolean;
  strike: boolean;
  code: boolean;
  href: string | null;
}

function runsOf(nodes: TiptapNode[] | undefined): Array<Run | 'br'> {
  const out: Array<Run | 'br'> = [];
  for (const n of nodes ?? []) {
    if (n.type === 'hardBreak') {
      out.push('br');
      continue;
    }
    if (n.type !== 'text' || !n.text) continue;
    const has = (t: string) => (n.marks ?? []).some((m) => m.type === t);
    const link = (n.marks ?? []).find((m) => m.type === 'link');
    const run: Run = { text: n.text, bold: has('bold'), italic: has('italic'), strike: has('strike'), code: has('code'), href: (link?.attrs?.href as string) ?? null };
    const last = out[out.length - 1];
    if (last && last !== 'br' && last.bold === run.bold && last.italic === run.italic && last.strike === run.strike && last.code === run.code && last.href === run.href) last.text += run.text;
    else out.push(run);
  }
  return out;
}

function inlineMarkdown(nodes: TiptapNode[] | undefined): string {
  let s = '';
  for (const r of runsOf(nodes)) {
    if (r === 'br') {
      s += '  \n';
      continue;
    }
    // Spaces stay outside the markers, or Markdown would not read them as emphasis or code.
    const [, lead, core, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(r.text)!;
    if (r.code) {
      const fence = core.includes('`') ? '``' : '`';
      const c = core ? `${fence}${core}${fence}` : '';
      s += escapeText(lead) + (r.href && c ? `[${c}](${r.href})` : c) + escapeText(trail);
      continue;
    }
    let t = escapeText(core);
    if (core) {
      if (r.strike) t = `~~${t}~~`;
      if (r.italic) t = `*${t}*`;
      if (r.bold) t = `**${t}**`;
      if (r.href) t = `[${t}](${r.href})`;
    }
    s += escapeText(lead) + t + escapeText(trail);
  }
  return s;
}

const indent = (s: string, by: string) =>
  s
    .split('\n')
    .map((l, i) => (i === 0 || l === '' ? l : by + l))
    .join('\n');

function blockMarkdown(n: TiptapNode): string | null {
  switch (n.type) {
    case 'paragraph':
      return escapeLineStart(inlineMarkdown(n.content));
    case 'heading':
      return `${'#'.repeat(Number(n.attrs?.level ?? 1))} ${inlineMarkdown(n.content)}`;
    case 'bulletList':
    case 'taskList':
    case 'orderedList': {
      const start = Number(n.attrs?.start ?? 1);
      return (n.content ?? [])
        .map((item, i) => {
          const marker = n.type === 'orderedList' ? `${start + i}. ` : '- ';
          const inner = (item.content ?? []).map(blockMarkdown).filter((x) => x !== null).join('\n');
          return marker + indent(inner, ' '.repeat(marker.length));
        })
        .join('\n');
    }
    case 'blockquote':
      return (n.content ?? [])
        .map(blockMarkdown)
        .filter((x) => x !== null)
        .join('\n\n')
        .split('\n')
        .map((l) => (l ? `> ${l}` : '>'))
        .join('\n');
    case 'codeBlock':
      return `\`\`\`${(n.attrs?.language as string) ?? ''}\n${(n.content ?? []).map((t) => t.text ?? '').join('')}\n\`\`\``;
    case 'horizontalRule':
      return '---';
    case 'image':
      return '[photo]';
    case 'table': {
      const rows = (n.content ?? []).map((row) =>
        (row.content ?? []).map((cell) => (cell.content ?? []).map((b) => inlineMarkdown(b.content)).join(' ').replace(/\|/g, '\\|')),
      );
      if (!rows.length) return null;
      const line = (cells: string[]) => `| ${cells.join(' | ')} |`;
      return [line(rows[0]), line(rows[0].map(() => '---')), ...rows.slice(1).map(line)].join('\n');
    }
    default:
      return n.content ? inlineMarkdown(n.content) : null;
  }
}

/** A note as Markdown with the same features; what Markdown cannot express is left out. */
export function docToMarkdown(doc: TiptapDoc): string {
  return (doc.content ?? [])
    .map(blockMarkdown)
    .filter((b): b is string => b !== null && b !== '')
    .join('\n\n');
}
