// The editor toolbar, left to right as in the reference screenshots:
//  1 Styles  2 Font  3 Size  4 Text colour, highlight  5 B I U S code link
//  6 Heading  7 List  8 Insert  9 Undo, redo
// plus table controls (cursor in a table) and photo controls (photo selected).
import { useContext, useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import {
  Baseline,
  Bold,
  ChevronDown,
  Code,
  Highlighter,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Pilcrow,
  Plus,
  Quote,
  Redo2,
  Strikethrough,
  Table as TableIcon,
  Underline,
  Undo2,
  Heading,
  SeparatorHorizontal,
  Lock,
  LockOpen,
  RemoveFormatting,
} from 'lucide-react';
import { DEFAULT_FONT_FAMILY, DEFAULT_FONT_SIZE, MAX_FONT_SIZE, MIN_FONT_SIZE } from '../../shared/constants';
import { findPalette, PALETTE } from '../../shared/palette';
import type { Style } from '../../shared/styles';
import type { Font } from '../../shared/types';
import { Dropdown, MenuItem, ToolButton, ToolbarDisabled } from '../components/Dropdown';
import { clearFormatting } from './clear';
import { invisiblesOn, setInvisibles } from './invisibles';
import { currentFormat, matchingStyle, quoteFamily, applyStyle, type CurrentFormat } from './stamp';
import { PhotoControls } from './PhotoControls';
import { TableControls } from './TableControls';

const ICON = 18;

/** How a style looks in previews (dropdown and style cards). */
export function stylePreviewCss(s: Pick<Style, 'fontFamily' | 'size' | 'bold' | 'italic' | 'underline' | 'strike' | 'textColor' | 'highlight'>, maxSize = 30): React.CSSProperties {
  const deco = [s.underline ? 'underline' : '', s.strike ? 'line-through' : ''].filter(Boolean).join(' ');
  return {
    fontFamily: `${quoteFamily(s.fontFamily)}, ${DEFAULT_FONT_FAMILY}, sans-serif`,
    fontSize: `${Math.min(s.size, maxSize)}px`,
    fontWeight: s.bold ? 700 : 400,
    fontStyle: s.italic ? 'italic' : 'normal',
    textDecoration: deco || 'none',
    color: findPalette(s.textColor)?.text,
    backgroundColor: findPalette(s.highlight)?.highlight,
  };
}

// ---------------------------------------------------------------- 1. Styles

export function StylesDropdown(props: { editor: Editor; styles: Style[]; onSaveSelection: () => void; onManage: () => void }) {
  const fmt = useEditorState({ editor: props.editor, selector: ({ editor }) => currentFormat(editor) }) as CurrentFormat;
  const match = matchingStyle(fmt, props.styles);
  return (
    <Dropdown
      label="Styles"
      className="tb-select tb-styles"
      menuClassName="menu-styles"
      button={
        <>
          <span className="tb-select-text">{match ? match.name : 'Styles'}</span>
          <ChevronDown size={14} />
        </>
      }
    >
      {(close) => (
        <>
          <div className="menu-scroll">
            {props.styles.length === 0 && <div className="menu-empty">No styles yet</div>}
            {props.styles.map((s) => (
              <MenuItem
                key={s.id}
                label={s.name}
                active={match?.id === s.id}
                onSelect={() => {
                  applyStyle(props.editor, s);
                  close();
                }}
              >
                <span className="style-preview" style={stylePreviewCss(s)}>
                  {s.name}
                </span>
              </MenuItem>
            ))}
          </div>
          <div className="menu-sep" />
          <MenuItem
            onSelect={() => {
              close();
              props.onSaveSelection();
            }}
          >
            Save selection as style…
          </MenuItem>
          <MenuItem
            onSelect={() => {
              close();
              props.onManage();
            }}
          >
            Manage styles…
          </MenuItem>
        </>
      )}
    </Dropdown>
  );
}

// ---------------------------------------------------------------- 2. Font

export function FontDropdown(props: { editor: Editor; fonts: Font[]; onBrowse: () => void }) {
  const family = useEditorState({ editor: props.editor, selector: ({ editor }) => currentFormat(editor).fontFamily }) as string | null;
  const active = props.fonts.filter((f) => !f.archived);
  const shown = family ?? DEFAULT_FONT_FAMILY;
  return (
    <Dropdown
      label="Font"
      className="tb-select tb-font"
      menuClassName="menu-fonts"
      button={
        <>
          <span className="tb-select-text">{shown}</span>
          <ChevronDown size={14} />
        </>
      }
    >
      {(close) => (
        <>
          <div className="menu-scroll">
            {active.map((f) => (
              <MenuItem
                key={f.id}
                label={f.family}
                active={f.family === shown}
                style={{ fontFamily: `${quoteFamily(f.family)}, sans-serif` }}
                onSelect={() => {
                  props.editor.chain().focus().setFontFamily(quoteFamily(f.family)).run();
                  close();
                }}
              >
                {f.family}
              </MenuItem>
            ))}
          </div>
          <div className="menu-sep" />
          <MenuItem
            onSelect={() => {
              close();
              props.onBrowse();
            }}
          >
            Browse fonts…
          </MenuItem>
        </>
      )}
    </Dropdown>
  );
}

// ---------------------------------------------------------------- 3. Size

export const clampSize = (n: number) => Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, Math.round(n)));

export function FontSizeControl(props: { editor: Editor }) {
  const size = useEditorState({ editor: props.editor, selector: ({ editor }) => currentFormat(editor).size }) as number | null;
  const current = size ?? DEFAULT_FONT_SIZE;
  const off = useContext(ToolbarDisabled);
  const [text, setText] = useState(String(current));
  useEffect(() => setText(String(current)), [current]);
  const apply = (n: number) => {
    if (!Number.isFinite(n)) {
      setText(String(current));
      return;
    }
    const v = clampSize(n);
    setText(String(v));
    props.editor.chain().focus().setFontSize(`${v}px`).run();
  };
  return (
    <div className="tb-group tb-size">
      <ToolButton label="Decrease font size" onClick={() => apply(current - 1)} disabled={current <= MIN_FONT_SIZE}>
        <Minus size={ICON} />
      </ToolButton>
      <input
        className="tb-size-input"
        aria-label="Font size"
        disabled={off}
        inputMode="numeric"
        value={text}
        onChange={(e) => setText(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            apply(parseInt(text, 10));
          }
        }}
        onBlur={() => {
          if (text !== String(current)) apply(parseInt(text, 10));
        }}
      />
      <ToolButton label="Increase font size" onClick={() => apply(current + 1)} disabled={current >= MAX_FONT_SIZE}>
        <Plus size={ICON} />
      </ToolButton>
    </div>
  );
}

// ---------------------------------------------------------------- 4. Colours

/** One colour in a picker: a swatch only, named for screen readers and on hover. */
function Swatch(props: { label: string; color?: string; none?: boolean; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={props.selected}
      aria-label={props.label}
      title={props.label}
      className={`swatch-item ${props.none ? 'swatch-none' : ''} ${props.selected ? 'is-selected' : ''}`}
      style={props.color ? { background: props.color } : undefined}
      onMouseDown={(e) => e.preventDefault()}
      onClick={props.onSelect}
    />
  );
}

export function TextColorDropdown(props: { editor: Editor }) {
  const color = useEditorState({ editor: props.editor, selector: ({ editor }) => currentFormat(editor).textColor }) as string | null;
  return (
    <Dropdown
      label="Text colour"
      menuClassName="menu-swatches"
      button={
        <span className="color-btn">
          <Baseline size={ICON} />
          <span className="color-bar" style={{ background: findPalette(color)?.text ?? 'transparent' }} />
        </span>
      }
    >
      {(close) => (
        <div className="swatch-grid">
          <Swatch
            label="Default text colour"
            none
            selected={color === null}
            onSelect={() => {
              props.editor.chain().focus().unsetColor().run();
              close();
            }}
          />
          {PALETTE.map((p) => (
            <Swatch
              key={p.name}
              label={`Text colour ${p.name}`}
              color={p.text}
              selected={color === p.name}
              onSelect={() => {
                props.editor.chain().focus().setColor(p.text).run();
                close();
              }}
            />
          ))}
        </div>
      )}
    </Dropdown>
  );
}

export function HighlightDropdown(props: { editor: Editor }) {
  const color = useEditorState({ editor: props.editor, selector: ({ editor }) => currentFormat(editor).highlight }) as string | null;
  return (
    <Dropdown
      label="Highlight colour"
      menuClassName="menu-swatches"
      button={
        <span className="color-btn">
          <Highlighter size={ICON} />
          <span className="color-bar" style={{ background: findPalette(color)?.highlight ?? 'transparent' }} />
        </span>
      }
    >
      {(close) => (
        <div className="swatch-grid">
          <Swatch
            label="No highlight"
            none
            selected={color === null}
            onSelect={() => {
              props.editor.chain().focus().unsetHighlight().run();
              close();
            }}
          />
          {PALETTE.map((p) => (
            <Swatch
              key={p.name}
              label={`Highlight ${p.name}`}
              color={p.highlight}
              selected={color === p.name}
              onSelect={() => {
                props.editor.chain().focus().setHighlight({ color: p.highlight }).run();
                close();
              }}
            />
          ))}
        </div>
      )}
    </Dropdown>
  );
}

// ---------------------------------------------------------------- 5. Marks and link

export function normalizeLink(input: string): string | null {
  const v = input.trim();
  if (!v) return null;
  if (/^(https?:\/\/|mailto:)/i.test(v)) return v;
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return null; // other schemes (javascript:, data:, ...) are refused
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return `mailto:${v}`;
  return `https://${v}`;
}

export function LinkButton(props: { editor: Editor }) {
  const state = useEditorState({
    editor: props.editor,
    selector: ({ editor }) => ({ active: editor.isActive('link'), href: (editor.getAttributes('link').href as string) ?? '' }),
  }) as { active: boolean; href: string };
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  const apply = () => {
    const href = normalizeLink(value);
    if (!href) {
      setError('Enter a web or email address.');
      return;
    }
    props.editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
    setOpen(false);
  };
  return (
    <div className="dropdown" ref={ref}>
      <ToolButton
        label="Link"
        active={state.active}
        onClick={() => {
          setValue(state.href);
          setError(null);
          setOpen((o) => !o);
        }}
      >
        <LinkIcon size={ICON} />
      </ToolButton>
      {open && (
        <div className="menu link-popover" role="dialog" aria-label="Link">
          <input
            autoFocus
            aria-label="Link address"
            placeholder="https://example.com"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                apply();
              } else if (e.key === 'Escape') setOpen(false);
            }}
          />
          <div className="link-actions">
            <button type="button" className="btn btn-primary btn-sm" onClick={apply}>
              Apply
            </button>
            {state.active && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  props.editor.chain().focus().extendMarkRange('link').unsetLink().run();
                  setOpen(false);
                }}
              >
                Remove link
              </button>
            )}
          </div>
          {error && (
            <div role="alert" className="form-error">
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MarkButtons(props: { editor: Editor }) {
  const s = useEditorState({
    editor: props.editor,
    selector: ({ editor }) => ({
      bold: editor.isActive('bold'),
      italic: editor.isActive('italic'),
      underline: editor.isActive('underline'),
      strike: editor.isActive('strike'),
      code: editor.isActive('code'),
    }),
  }) as Record<string, boolean>;
  const c = () => props.editor.chain().focus();
  return (
    <div className="tb-group">
      <ToolButton label="Bold" active={s.bold} onClick={() => c().toggleBold().run()}>
        <Bold size={ICON} />
      </ToolButton>
      <ToolButton label="Italic" active={s.italic} onClick={() => c().toggleItalic().run()}>
        <Italic size={ICON} />
      </ToolButton>
      <ToolButton label="Underline" active={s.underline} onClick={() => c().toggleUnderline().run()}>
        <Underline size={ICON} />
      </ToolButton>
      <ToolButton label="Strikethrough" active={s.strike} onClick={() => c().toggleStrike().run()}>
        <Strikethrough size={ICON} />
      </ToolButton>
      <ToolButton label="Inline code" active={s.code} onClick={() => c().toggleCode().run()}>
        <Code size={ICON} />
      </ToolButton>
      <LinkButton editor={props.editor} />
    </div>
  );
}

// ---------------------------------------------------------------- 6-8. Heading, list, insert

export function HeadingDropdown(props: { editor: Editor }) {
  const level = useEditorState({
    editor: props.editor,
    selector: ({ editor }) => ([1, 2, 3] as const).find((l) => editor.isActive('heading', { level: l })) ?? 0,
  }) as number;
  const c = () => props.editor.chain().focus();
  return (
    <Dropdown
      label="Heading"
      button={
        <>
          {level ? <span className="tb-h">H{level}</span> : <Heading size={ICON} />}
          <ChevronDown size={12} />
        </>
      }
    >
      {(close) => (
        <>
          <MenuItem active={level === 0} onSelect={() => (c().setParagraph().run(), close())}>
            <Pilcrow size={16} /> Normal text
          </MenuItem>
          {([1, 2, 3] as const).map((l) => (
            <MenuItem key={l} active={level === l} onSelect={() => (c().setHeading({ level: l }).run(), close())}>
              <span className="menu-h">H{l}</span> Heading {l}
            </MenuItem>
          ))}
        </>
      )}
    </Dropdown>
  );
}

export function ListDropdown(props: { editor: Editor }) {
  const s = useEditorState({
    editor: props.editor,
    selector: ({ editor }) => ({ bullet: editor.isActive('bulletList'), ordered: editor.isActive('orderedList'), task: editor.isActive('taskList') }),
  }) as Record<string, boolean>;
  const c = () => props.editor.chain().focus();
  return (
    <Dropdown
      label="List"
      button={
        <>
          <List size={ICON} />
          <ChevronDown size={12} />
        </>
      }
    >
      {(close) => (
        <>
          <MenuItem active={s.bullet} onSelect={() => (c().toggleBulletList().run(), close())}>
            <List size={16} /> Bullet list
          </MenuItem>
          <MenuItem active={s.ordered} onSelect={() => (c().toggleOrderedList().run(), close())}>
            <ListOrdered size={16} /> Numbered list
          </MenuItem>
          <MenuItem active={s.task} onSelect={() => (c().toggleTaskList().run(), close())}>
            <ListChecks size={16} /> Task list
          </MenuItem>
        </>
      )}
    </Dropdown>
  );
}

export const IMAGE_ACCEPT = 'image/jpeg,image/png,image/gif,image/webp';

export function InsertDropdown(props: { editor: Editor; onPickImage: (file: File) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const c = () => props.editor.chain().focus();
  return (
    <>
      <Dropdown
        label="Insert"
        align="right"
        button={
          <>
            <Plus size={ICON} />
            <ChevronDown size={12} />
          </>
        }
      >
        {(close) => (
          <>
            <MenuItem onSelect={() => (c().setHorizontalRule().run(), close())}>
              <SeparatorHorizontal size={16} /> Horizontal line
            </MenuItem>
            <MenuItem onSelect={() => (c().toggleBlockquote().run(), close())}>
              <Quote size={16} /> Block quote
            </MenuItem>
            <MenuItem onSelect={() => (c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(), close())}>
              <TableIcon size={16} /> Table
            </MenuItem>
            <MenuItem
              onSelect={() => {
                close();
                fileRef.current?.click();
              }}
            >
              <ImageIcon size={16} /> Image
            </MenuItem>
          </>
        )}
      </Dropdown>
      <input
        ref={fileRef}
        type="file"
        accept={IMAGE_ACCEPT}
        hidden
        data-testid="image-file-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) props.onPickImage(file);
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------- 9. Undo / redo

function UndoRedo(props: { editor: Editor }) {
  const s = useEditorState({
    editor: props.editor,
    selector: ({ editor }) => ({ undo: editor.can().undo(), redo: editor.can().redo() }),
  }) as { undo: boolean; redo: boolean };
  return (
    <div className="tb-group">
      <ToolButton label="Undo" disabled={!s.undo} onClick={() => props.editor.chain().focus().undo().run()}>
        <Undo2 size={ICON} />
      </ToolButton>
      <ToolButton label="Redo" disabled={!s.redo} onClick={() => props.editor.chain().focus().redo().run()}>
        <Redo2 size={ICON} />
      </ToolButton>
    </div>
  );
}

// ---------------------------------------------------------------- the toolbar

export interface ToolbarProps {
  editor: Editor;
  styles: Style[];
  fonts: Font[];
  onSaveSelectionAsStyle: () => void;
  onManageStyles: () => void;
  onBrowseFonts: () => void;
  onPickImage: (file: File) => void;
  /** The note is read-only: every control is switched off. */
  readOnly?: boolean;
  /** Shows the read-only toggle at the end; called after the in-page confirmation. */
  onMakeReadOnly?: () => Promise<void> | void;
}

/** Shows spaces, tabs and line ends. It changes nothing, so it stays enabled on read-only notes. */
function InvisiblesToggle(props: { editor: Editor }) {
  const on = useEditorState({ editor: props.editor, selector: ({ editor }) => invisiblesOn(editor) }) as boolean;
  return (
    <ToolButton label="Show spaces, tabs and line ends" active={on} alwaysEnabled onClick={() => setInvisibles(props.editor, !on)}>
      <Pilcrow size={ICON} />
    </ToolButton>
  );
}

/** The lock at the end of the toolbar. Turning it on asks once more; the web app cannot turn it off. */
function ReadOnlyToggle(props: { readOnly: boolean; onRequest: () => void }) {
  return (
    <button
      type="button"
      className={`tb-btn tb-lock ${props.readOnly ? 'is-active' : ''}`}
      aria-label={props.readOnly ? 'Read-only' : 'Make read-only'}
      title={props.readOnly ? 'Read-only' : 'Make read-only'}
      aria-pressed={props.readOnly}
      disabled={props.readOnly}
      onMouseDown={(e) => e.preventDefault()}
      onClick={props.onRequest}
    >
      {props.readOnly ? <Lock size={ICON} /> : <LockOpen size={ICON} />}
    </button>
  );
}

function ReadOnlyConfirm(props: { onConfirm: () => Promise<void> | void; onCancel: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="readonly-confirm" role="group" aria-label="Make read-only">
      <span>
        Make this note read-only? Once read-only, nothing about the note can be changed and it cannot be deleted. It can only be made writable
        again from the command line on the server.
      </span>
      <button
        type="button"
        className="btn btn-sm btn-danger"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await props.onConfirm();
          } finally {
            setBusy(false);
          }
        }}
      >
        Confirm: make read-only
      </button>
      <button type="button" className="btn btn-sm" disabled={busy} onClick={props.onCancel}>
        Cancel
      </button>
    </div>
  );
}

export function Toolbar(props: ToolbarProps) {
  const { editor } = props;
  const readOnly = !!props.readOnly;
  const [confirming, setConfirming] = useState(false);
  const ctx = useEditorState({
    editor,
    selector: ({ editor }) => ({ inTable: editor.isActive('table'), photo: editor.isActive('image') }),
  }) as { inTable: boolean; photo: boolean };
  return (
    <ToolbarDisabled.Provider value={readOnly}>
    <div className="toolbar-wrap">
      <div className="toolbar" role="toolbar" aria-label="Formatting">
        <StylesDropdown editor={editor} styles={props.styles} onSaveSelection={props.onSaveSelectionAsStyle} onManage={props.onManageStyles} />
        <span className="tb-sep" />
        <FontDropdown editor={editor} fonts={props.fonts} onBrowse={props.onBrowseFonts} />
        <span className="tb-sep" />
        <FontSizeControl editor={editor} />
        <span className="tb-sep" />
        <div className="tb-group">
          <TextColorDropdown editor={editor} />
          <HighlightDropdown editor={editor} />
        </div>
        <span className="tb-sep" />
        <MarkButtons editor={editor} />
        <span className="tb-sep" />
        <div className="tb-group">
          <HeadingDropdown editor={editor} />
          <ListDropdown editor={editor} />
          <InsertDropdown editor={editor} onPickImage={props.onPickImage} />
        </div>
        <span className="tb-sep" />
        <UndoRedo editor={editor} />
        <span className="tb-sep" />
        <div className="tb-group">
          <ToolButton label="Clear formatting" onClick={() => clearFormatting(editor)}>
            <RemoveFormatting size={ICON} />
          </ToolButton>
          <InvisiblesToggle editor={editor} />
        </div>
        {props.onMakeReadOnly && (
          <>
            <span className="tb-sep" />
            <ReadOnlyToggle readOnly={readOnly} onRequest={() => setConfirming(true)} />
          </>
        )}
      </div>
      {confirming && !readOnly && props.onMakeReadOnly && (
        <ReadOnlyConfirm
          onConfirm={async () => {
            await props.onMakeReadOnly!();
            setConfirming(false);
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
      {!readOnly && ctx.inTable && <TableControls editor={editor} />}
      {!readOnly && ctx.photo && <PhotoControls editor={editor} />}
    </div>
    </ToolbarDisabled.Provider>
  );
}
