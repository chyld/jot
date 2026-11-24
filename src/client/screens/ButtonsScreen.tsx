// The /buttons page: ten fixed places (1–10) for binding styles to editor toolbar
// buttons and hiding or showing them. Changes save immediately.
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Eye, EyeOff, Plus } from 'lucide-react';
import { buttonColor, type ButtonSlot, type StyleButtonPatch } from '../../shared/buttons';
import { useData } from '../data';
import { stylePreviewCss } from '../editor/Toolbar';

export function ButtonsScreen() {
  const { buttons, styles, updateButton } = useData();
  const [openSlot, setOpenSlot] = useState<ButtonSlot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const openRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (openSlot === null) return;
    const onDown = (e: MouseEvent) => {
      if (openRef.current && !openRef.current.contains(e.target as Node)) setOpenSlot(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenSlot(null);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [openSlot]);

  const stylesById = new Map(styles.map((s) => [s.id, s]));
  const inUse = buttons.filter((b) => b.styleId !== null && stylesById.has(b.styleId)).length;
  const hiddenCount = buttons.filter((b) => b.hidden).length;

  const save = async (slot: ButtonSlot, patch: StyleButtonPatch) => {
    setError(null);
    try {
      await updateButton(slot, patch);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save button.');
    }
  };

  return (
    <div className="screen">
      <div className="screen-head">
        <h1>Buttons</h1>
        <span className="muted">
          {inUse} of 10 in use{hiddenCount > 0 ? ` · ${hiddenCount} hidden` : ''}
        </span>
      </div>
      <p className="muted hint">Each button applies one of your styles from the editor toolbar. Changes save immediately.</p>
      {error && (
        <div role="alert" className="form-error" style={{ marginBottom: 12 }}>
          {error}
        </div>
      )}
      <div className="buttons-grid" data-testid="buttons-grid">
        {buttons.map((b) => {
          const bound = b.styleId ? (stylesById.get(b.styleId) ?? null) : null;
          const open = openSlot === b.slot;
          const color = buttonColor(b.slot);
          return (
            <article
              key={b.slot}
              className={`btn-slot${!bound ? ' is-empty' : ''}${b.hidden ? ' is-hidden' : ''}${open ? ' is-picking' : ''}`}
              aria-label={`Button ${b.slot}`}
              data-testid={`button-slot-${b.slot}`}
            >
              <div className="btn-slot-top">
                <span className={`style-chip${!bound ? ' is-empty' : ''}`} style={{ '--chip-color': color } as React.CSSProperties} aria-hidden="true">
                  {b.slot}
                </span>
                <span className="grow" />
                <button
                  type="button"
                  className="btn-slot-eye"
                  aria-label={b.hidden ? `Show button ${b.slot}` : `Hide button ${b.slot}`}
                  title={b.hidden ? 'Show in toolbar' : 'Hide from toolbar'}
                  aria-pressed={b.hidden}
                  onClick={() => void save(b.slot, { hidden: !b.hidden })}
                >
                  {b.hidden ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
              <div className="btn-slot-body" ref={open ? openRef : undefined}>
                {bound ? (
                  <button
                    type="button"
                    className={`btn-slot-select${open ? ' is-open' : ''}`}
                    aria-label={`Button ${b.slot} style: ${bound.name}`}
                    aria-haspopup="menu"
                    aria-expanded={open}
                    onClick={() => setOpenSlot(open ? null : b.slot)}
                  >
                    <span className="style-preview btn-slot-preview" style={stylePreviewCss(bound, 20)}>
                      {bound.name}
                    </span>
                    <ChevronDown size={14} className="btn-slot-caret" />
                  </button>
                ) : (
                  <button
                    type="button"
                    className={`btn-slot-bind${open ? ' is-open' : ''}`}
                    aria-label={`Bind a style to button ${b.slot}`}
                    aria-haspopup="menu"
                    aria-expanded={open}
                    onClick={() => setOpenSlot(open ? null : b.slot)}
                  >
                    <Plus size={15} />
                    <span>Bind a style</span>
                  </button>
                )}
                {open && (
                  <div role="menu" aria-label={`Style for button ${b.slot}`} className="menu btn-slot-menu">
                    <div className="menu-scroll">
                      {styles.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          role="menuitem"
                          aria-label={s.name}
                          className={`menu-item${bound?.id === s.id ? ' is-active' : ''}`}
                          onClick={() => {
                            setOpenSlot(null);
                            void save(b.slot, { styleId: s.id });
                          }}
                        >
                          <span className="style-preview" style={stylePreviewCss(s, 22)}>
                            {s.name}
                          </span>
                        </button>
                      ))}
                    </div>
                    <div className="menu-sep" />
                    <button
                      type="button"
                      role="menuitem"
                      className={`menu-item btn-slot-none${!bound ? ' is-active' : ''}`}
                      onClick={() => {
                        setOpenSlot(null);
                        void save(b.slot, { styleId: null });
                      }}
                    >
                      No style
                    </button>
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
