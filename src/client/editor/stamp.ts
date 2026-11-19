// Named styles are stamps: applying one copies its font, size, options and colours
// onto the text as plain formatting. Nothing links the text back to the style, so
// editing or deleting the style later leaves existing text unchanged.
import type { Editor } from '@tiptap/core';
import { findPalette, highlightColorName, textColorName } from '../../shared/palette';
import type { Style } from '../../shared/styles';

export const quoteFamily = (family: string) => `"${family}"`;
export const unquoteFamily = (value: unknown) => (typeof value === 'string' ? value.trim().replace(/^["']|["']$/g, '') : null);

/**
 * Stamps a style onto the selection. With an empty selection it stamps the whole
 * current paragraph (and the formatting carries on as you type).
 */
export function applyStyle(editor: Editor, style: Style): boolean {
  const { selection } = editor.state;
  let chain = editor.chain().focus();
  if (selection.empty) {
    const { $from } = selection;
    if ($from.parent.isTextblock && $from.parent.content.size > 0) {
      chain = chain.setTextSelection({ from: $from.start(), to: $from.end() });
    }
  }
  chain = chain
    .unsetMark('bold')
    .unsetMark('italic')
    .unsetMark('underline')
    .unsetMark('strike')
    .unsetMark('highlight')
    .setMark('textStyle', {
      fontFamily: quoteFamily(style.fontFamily),
      fontSize: `${style.size}px`,
      color: findPalette(style.textColor)?.text ?? null,
    });
  if (style.bold) chain = chain.setMark('bold');
  if (style.italic) chain = chain.setMark('italic');
  if (style.underline) chain = chain.setMark('underline');
  if (style.strike) chain = chain.setMark('strike');
  if (style.highlight) chain = chain.setMark('highlight', { color: findPalette(style.highlight)!.highlight });
  return chain.run();
}

/** The formatting at the cursor, in style terms (used for matching and "Save selection as style"). */
export interface CurrentFormat {
  fontFamily: string | null;
  size: number | null;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  textColor: string | null;
  highlight: string | null;
}

export function currentFormat(editor: Editor): CurrentFormat {
  const ts = editor.getAttributes('textStyle');
  const size = typeof ts.fontSize === 'string' ? parseInt(ts.fontSize, 10) : NaN;
  return {
    fontFamily: unquoteFamily(ts.fontFamily) || null,
    size: Number.isFinite(size) ? size : null,
    bold: editor.isActive('bold'),
    italic: editor.isActive('italic'),
    underline: editor.isActive('underline'),
    strike: editor.isActive('strike'),
    textColor: textColorName(ts.color),
    highlight: editor.isActive('highlight') ? highlightColorName(editor.getAttributes('highlight').color) : null,
  };
}

/** The first style whose stamp matches the formatting at the cursor, if any. */
export function matchingStyle(fmt: CurrentFormat, styles: Style[]): Style | null {
  return (
    styles.find(
      (s) =>
        fmt.fontFamily === s.fontFamily &&
        fmt.size === s.size &&
        fmt.bold === s.bold &&
        fmt.italic === s.italic &&
        fmt.underline === s.underline &&
        fmt.strike === s.strike &&
        fmt.textColor === (s.textColor ?? null) &&
        fmt.highlight === (s.highlight ?? null),
    ) ?? null
  );
}
