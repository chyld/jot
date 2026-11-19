// A small accessible dropdown menu. Mouse-down on its controls does not steal focus
// from the editor, so the text selection survives while choosing an item.
import { useEffect, useRef, useState, type ReactNode } from 'react';

const keepFocus = (e: React.MouseEvent) => e.preventDefault();

export function Dropdown(props: {
  label: string;
  button: ReactNode;
  className?: string;
  menuClassName?: string;
  align?: 'left' | 'right';
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div className="dropdown" ref={ref}>
      <button
        type="button"
        className={`tb-btn ${props.className ?? ''}`}
        aria-label={props.label}
        title={props.label}
        aria-haspopup="menu"
        aria-expanded={open}
        onMouseDown={keepFocus}
        onClick={() => setOpen((o) => !o)}
      >
        {props.button}
      </button>
      {open && (
        <div role="menu" aria-label={props.label} className={`menu ${props.align === 'right' ? 'menu-right' : ''} ${props.menuClassName ?? ''}`}>
          {props.children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem(props: { onSelect: () => void; children: ReactNode; active?: boolean; style?: React.CSSProperties; label?: string }) {
  return (
    <button
      type="button"
      role="menuitem"
      aria-label={props.label}
      className={`menu-item ${props.active ? 'is-active' : ''}`}
      style={props.style}
      onMouseDown={keepFocus}
      onClick={props.onSelect}
    >
      {props.children}
    </button>
  );
}

export function ToolButton(props: {
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`tb-btn ${props.active ? 'is-active' : ''}`}
      aria-label={props.label}
      title={props.label}
      aria-pressed={props.active === undefined ? undefined : props.active}
      disabled={props.disabled}
      onMouseDown={keepFocus}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}
