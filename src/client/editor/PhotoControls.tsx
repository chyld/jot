// Shown when a photo is selected: width, border size (0-10 px) and border colour
// (one of the 10 palette border colours).
import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { Minus, Plus } from 'lucide-react';
import { MAX_BORDER_WIDTH, MIN_BORDER_WIDTH } from '../../shared/constants';
import { PALETTE } from '../../shared/palette';
import { DEFAULT_BORDER_COLOR, MAX_PHOTO_WIDTH, MIN_PHOTO_WIDTH, photoResizeEvents } from './photo';

const WIDTH_STEP = 20;

function renderedWidth(editor: Editor): number | null {
  const dom = editor.view.nodeDOM(editor.state.selection.from) as HTMLElement | null;
  const img = dom?.querySelector?.('img');
  const w = img?.getBoundingClientRect().width;
  return w && w > 0 ? Math.round(w) : null;
}

export function PhotoControls(props: { editor: Editor }) {
  const { editor } = props;
  const attrs = useEditorState({
    editor,
    selector: ({ editor }) => {
      const a = editor.getAttributes('image');
      return { width: (a.width as number | null) ?? null, borderWidth: (a.borderWidth as number) ?? 0, borderColor: (a.borderColor as string | null) ?? null };
    },
  }) as { width: number | null; borderWidth: number; borderColor: string | null };

  const [widthText, setWidthText] = useState(attrs.width ? String(attrs.width) : '');
  useEffect(() => setWidthText(attrs.width ? String(attrs.width) : ''), [attrs.width]);
  // Follow a corner drag live (the width is saved when the mouse is released).
  useEffect(() => {
    const onResize = (e: Event) => setWidthText(String((e as CustomEvent<{ width: number }>).detail.width));
    photoResizeEvents.addEventListener('resize', onResize);
    return () => photoResizeEvents.removeEventListener('resize', onResize);
  }, []);

  const update = (patch: Record<string, unknown>) => editor.chain().focus().updateAttributes('image', patch).run();
  const setWidth = (w: number) => {
    if (!Number.isFinite(w)) return;
    update({ width: Math.round(Math.min(MAX_PHOTO_WIDTH, Math.max(MIN_PHOTO_WIDTH, w))), height: null });
  };
  const baseWidth = () => attrs.width ?? renderedWidth(editor) ?? 400;
  const setBorder = (n: number) => update({ borderWidth: Math.max(MIN_BORDER_WIDTH, Math.min(MAX_BORDER_WIDTH, n)) });

  const keep = (e: React.MouseEvent) => e.preventDefault();
  return (
    <div className="context-bar" role="toolbar" aria-label="Photo">
      <span className="context-title">Photo</span>

      <span className="ctx-label">Width</span>
      <button type="button" className="ctx-btn" aria-label="Narrower" onMouseDown={keep} onClick={() => setWidth(baseWidth() - WIDTH_STEP)}>
        <Minus size={14} />
      </button>
      <input
        className="ctx-input"
        aria-label="Photo width"
        placeholder="auto"
        inputMode="numeric"
        value={widthText}
        onChange={(e) => setWidthText(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            setWidth(parseInt(widthText, 10));
          }
        }}
        onBlur={() => widthText && widthText !== String(attrs.width ?? '') && setWidth(parseInt(widthText, 10))}
      />
      <span className="ctx-unit">px</span>
      <button type="button" className="ctx-btn" aria-label="Wider" onMouseDown={keep} onClick={() => setWidth(baseWidth() + WIDTH_STEP)}>
        <Plus size={14} />
      </button>
      <button type="button" className="ctx-btn" onMouseDown={keep} onClick={() => update({ width: null, height: null })} disabled={attrs.width === null}>
        Original size
      </button>

      <span className="ctx-divider" />
      <label className="ctx-label" htmlFor="photo-border-size">
        Border
      </label>
      <select
        id="photo-border-size"
        className="ctx-input"
        aria-label="Border size"
        value={attrs.borderWidth}
        onChange={(e) => setBorder(parseInt(e.target.value, 10))}
      >
        {Array.from({ length: MAX_BORDER_WIDTH - MIN_BORDER_WIDTH + 1 }, (_, i) => i + MIN_BORDER_WIDTH).map((n) => (
          <option key={n} value={n}>
            {n === 0 ? 'None' : `${n} px`}
          </option>
        ))}
      </select>

      <span className="ctx-divider" />
      <span className="ctx-label">Colour</span>
      <div className="ctx-swatches" role="group" aria-label="Border colour">
        {PALETTE.map((p) => {
          const selected = (attrs.borderColor ?? DEFAULT_BORDER_COLOR) === p.name;
          return (
            <button
              key={p.name}
              type="button"
              className={`ctx-swatch ${selected ? 'is-selected' : ''}`}
              style={{ background: p.border }}
              aria-label={`Border colour ${p.name}`}
              aria-pressed={selected}
              title={p.name}
              onMouseDown={keep}
              onClick={() => update({ borderColor: p.name, ...(attrs.borderWidth === 0 ? { borderWidth: 2 } : {}) })}
            />
          );
        })}
      </div>
    </div>
  );
}
