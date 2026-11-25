// Create or edit a style: name, font, size, options and palette colours.
import { useState } from 'react';
import { DEFAULT_FONT_FAMILY, DEFAULT_FONT_SIZE, MAX_FONT_SIZE, MIN_FONT_SIZE } from '../../shared/constants';
import { PALETTE } from '../../shared/palette';
import { validateStyleInput, type StyleInput } from '../../shared/styles';
import type { Font } from '../../shared/types';
import { stylePreviewCss } from '../editor/Toolbar';

export function blankStyle(fonts: Font[]): StyleInput {
  const font = fonts.find((f) => f.family === DEFAULT_FONT_FAMILY && !f.archived) ?? fonts.find((f) => !f.archived) ?? fonts[0];
  return {
    name: '',
    fontId: font?.id ?? '',
    size: DEFAULT_FONT_SIZE,
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    textColor: null,
    highlight: null,
  };
}

export function StyleDialog(props: {
  title: string;
  initial: StyleInput;
  fonts: Font[];
  onSave: (input: StyleInput) => Promise<void>;
  onClose: () => void;
}) {
  const [s, setS] = useState<StyleInput>(props.initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Active fonts, plus this style's own font if it has been archived since.
  const fontChoices = props.fonts.filter((f) => !f.archived || f.id === props.initial.fontId);
  const customFonts = fontChoices.filter((f) => !f.isDefault);
  const defaultFonts = fontChoices.filter((f) => f.isDefault);
  const family = props.fonts.find((f) => f.id === s.fontId)?.family ?? DEFAULT_FONT_FAMILY;
  const set = (patch: Partial<StyleInput>) => {
    setS((cur) => ({ ...cur, ...patch }));
    setError(null);
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        onSubmit={async (e) => {
          e.preventDefault();
          const v = validateStyleInput(s);
          if (!v.ok) {
            setError(v.error);
            return;
          }
          setBusy(true);
          try {
            await props.onSave(v.value);
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not save the style.');
            setBusy(false);
          }
        }}
      >
        <h2>{props.title}</h2>
        <div className="style-dialog-preview" style={stylePreviewCss({ ...s, fontFamily: family }, 48)} data-testid="style-dialog-preview">
          {s.name || 'Style preview'}
        </div>
        <label>
          Name
          <input autoFocus value={s.name} maxLength={60} onChange={(e) => set({ name: e.target.value })} />
        </label>
        <div className="form-row">
          <label className="grow">
            Font
            <select value={s.fontId} onChange={(e) => set({ fontId: e.target.value })}>
              {customFonts.length > 0 && (
                <optgroup label="Your fonts">
                  {customFonts.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.family}
                      {f.archived ? ' (archived)' : ''}
                    </option>
                  ))}
                </optgroup>
              )}
              {defaultFonts.length > 0 && (
                <optgroup label="Default fonts">
                  {defaultFonts.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.family}
                      {f.archived ? ' (archived)' : ''}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
          <label className="size-field">
            Size (px)
            <input
              type="number"
              min={MIN_FONT_SIZE}
              max={MAX_FONT_SIZE}
              value={Number.isFinite(s.size) ? s.size : ''}
              onChange={(e) => set({ size: e.target.value === '' ? NaN : Number(e.target.value) })}
            />
          </label>
        </div>
        <fieldset className="toggles">
          <legend>Options</legend>
          {(
            [
              ['bold', 'Bold'],
              ['italic', 'Italic'],
              ['underline', 'Underline'],
              ['strike', 'Strikethrough'],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="toggle">
              <input type="checkbox" checked={s[k]} onChange={(e) => set({ [k]: e.target.checked })} /> {label}
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>Text colour</legend>
          <div className="swatch-row" role="radiogroup" aria-label="Text colour">
            <button type="button" role="radio" aria-checked={s.textColor === null} aria-label="No text colour" className={`swatch-btn swatch-none ${s.textColor === null ? 'is-selected' : ''}`} onClick={() => set({ textColor: null })} />
            {PALETTE.map((p) => (
              <button
                key={p.name}
                type="button"
                role="radio"
                aria-checked={s.textColor === p.name}
                aria-label={`Text colour ${p.name}`}
                title={p.name}
                className={`swatch-btn ${s.textColor === p.name ? 'is-selected' : ''}`}
                style={{ background: p.text }}
                onClick={() => set({ textColor: p.name })}
              />
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Highlight</legend>
          <div className="swatch-row" role="radiogroup" aria-label="Highlight colour">
            <button type="button" role="radio" aria-checked={s.highlight === null} aria-label="No highlight" className={`swatch-btn swatch-none ${s.highlight === null ? 'is-selected' : ''}`} onClick={() => set({ highlight: null })} />
            {PALETTE.map((p) => (
              <button
                key={p.name}
                type="button"
                role="radio"
                aria-checked={s.highlight === p.name}
                aria-label={`Highlight ${p.name}`}
                title={p.name}
                className={`swatch-btn ${s.highlight === p.name ? 'is-selected' : ''}`}
                style={{ background: p.highlight }}
                onClick={() => set({ highlight: p.name })}
              />
            ))}
          </div>
        </fieldset>
        {error && (
          <div role="alert" className="form-error">
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={props.onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Save style
          </button>
        </div>
      </form>
    </div>
  );
}
