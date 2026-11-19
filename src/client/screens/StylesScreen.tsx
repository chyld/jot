import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { findPalette } from '../../shared/palette';
import type { Style, StyleInput } from '../../shared/styles';
import { api } from '../api';
import { blankStyle, StyleDialog } from '../components/StyleDialog';
import { useData } from '../data';
import { stylePreviewCss } from '../editor/Toolbar';

export function StyleCard(props: { style: Style; onEdit: () => void; onDelete: () => void }) {
  const s = props.style;
  const [confirming, setConfirming] = useState(false);
  const text = findPalette(s.textColor);
  const hl = findPalette(s.highlight);
  return (
    <article className="card style-card" aria-label={`Style ${s.name}`} data-testid="style-card">
      <div className="style-card-name">
        <span style={stylePreviewCss(s, 44)}>{s.name}</span>
      </div>
      <ul className="chips" aria-label="Parts">
        <li className="chip">
          {s.fontFamily}
          {s.fontArchived ? ' (archived)' : ''}
        </li>
        <li className="chip">{s.size} px</li>
        {s.bold && <li className="chip">Bold</li>}
        {s.italic && <li className="chip">Italic</li>}
        {s.underline && <li className="chip">Underline</li>}
        {s.strike && <li className="chip">Strikethrough</li>}
        {text && (
          <li className="chip">
            <span className="dot" style={{ background: text.text }} /> {text.name}
          </li>
        )}
        {hl && (
          <li className="chip">
            <span className="square" style={{ background: hl.highlight }} /> {hl.name} highlight
          </li>
        )}
      </ul>
      <div className="card-actions">
        <button type="button" className="btn btn-sm" onClick={props.onEdit}>
          <Pencil size={14} /> Edit
        </button>
        {confirming ? (
          <>
            <button type="button" className="btn btn-sm btn-danger" onClick={props.onDelete}>
              Confirm delete
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-sm" onClick={() => setConfirming(true)}>
            <Trash2 size={14} /> Delete
          </button>
        )}
      </div>
    </article>
  );
}

export function StylesScreen() {
  const { styles, fonts, reloadStyles } = useData();
  const [editing, setEditing] = useState<{ id: string | null; input: StyleInput } | null>(null);
  return (
    <div className="screen">
      <div className="screen-head">
        <h1>Styles</h1>
        <span className="muted">{styles.length} {styles.length === 1 ? 'style' : 'styles'}</span>
        <button type="button" className="btn btn-primary" onClick={() => setEditing({ id: null, input: blankStyle(fonts) })}>
          <Plus size={16} /> New style
        </button>
      </div>
      <p className="muted hint">A style is a stamp: applying it copies its formatting onto your text. Editing or deleting a style later does not change text it was applied to.</p>
      <div className="card-grid">
        {styles.map((s) => (
          <StyleCard
            key={s.id}
            style={s}
            onEdit={() =>
              setEditing({
                id: s.id,
                input: { name: s.name, fontId: s.fontId, size: s.size, bold: s.bold, italic: s.italic, underline: s.underline, strike: s.strike, textColor: s.textColor, highlight: s.highlight },
              })
            }
            onDelete={async () => {
              await api.deleteStyle(s.id);
              await reloadStyles();
            }}
          />
        ))}
      </div>
      {editing && (
        <StyleDialog
          title={editing.id ? 'Edit style' : 'New style'}
          initial={editing.input}
          fonts={fonts}
          onClose={() => setEditing(null)}
          onSave={async (input) => {
            if (editing.id) await api.updateStyle(editing.id, input);
            else await api.createStyle(input);
            await reloadStyles();
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
