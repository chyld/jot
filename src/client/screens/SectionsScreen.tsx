// The Sections page (sections-spec.md §4, mockup A2), /sections: one card per section in
// that section's own colours, with its name, ID, number of notes, Edit, Open (or a "Current"
// mark) and Trash with the number of its trashed notes (each section has its own
// trash: the button makes the section current and opens the Trash screen); a "+ New section"
// card. The same dialog creates a section (name, ID, colour) and edits one (name and colour;
// the ID is fixed). There is no delete.
import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { normalizeSectionId, normalizeSectionName, SECTION_COLOURS, type Section, type SectionColour } from '../../shared/sections';
import { api } from '../api';
import { setCurrentSection, useSections } from '../currentSection';
import { SectionSquare } from '../components/SectionMarks';
import { useData } from '../data';
import { navigate } from '../router';
import { COLOUR_NAMES, THEMES, themeVars } from '../theme';

const noteCount = (n: number) => (n === 1 ? '1 note' : `${n} notes`);

function SectionDialog(props: { section: Section | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const editing = props.section;
  const [name, setName] = useState(editing?.name ?? '');
  const [id, setId] = useState(editing?.id ?? '');
  const [colour, setColour] = useState<SectionColour>(editing?.colour ?? 'olive');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const title = editing ? `Edit ${editing.name}` : 'New section';
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onSubmit={async (e) => {
          e.preventDefault();
          const n = normalizeSectionName(name);
          if (!n.ok) return setError(n.error);
          const i = normalizeSectionId(editing ? editing.id : id);
          if (!i.ok) return setError(i.error);
          setBusy(true);
          setError(null);
          try {
            if (editing) await api.updateSection(editing.id, { name: n.name, colour });
            else await api.createSection({ id: i.id, name: n.name, colour });
            await props.onSaved();
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not save the section.');
            setBusy(false);
          }
        }}
      >
        <h2>{title}</h2>
        <label>
          Name
          <input autoFocus value={name} maxLength={60} onChange={(e) => (setName(e.target.value), setError(null))} />
        </label>
        <label>
          ID
          <input
            value={id}
            maxLength={30}
            disabled={!!editing}
            spellCheck={false}
            aria-describedby="section-id-hint"
            onChange={(e) => (setId(e.target.value), setError(null))}
          />
        </label>
        <span id="section-id-hint" className="muted small">
          {editing ? 'The ID cannot be changed.' : 'Letters a–z only. The ID cannot be changed later.'}
        </span>
        <fieldset>
          <legend>Colour</legend>
          <div className="swatch-row" role="radiogroup" aria-label="Colour">
            {SECTION_COLOURS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={colour === c}
                aria-label={COLOUR_NAMES[c]}
                title={COLOUR_NAMES[c]}
                className={`swatch-btn ${colour === c ? 'is-selected' : ''}`}
                style={{ background: THEMES[c].accent }}
                onClick={() => setColour(c)}
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
            {editing ? 'Save' : 'Create section'}
          </button>
        </div>
      </form>
    </div>
  );
}

export function SectionsScreen() {
  const { reloadSections } = useData();
  const { sections, current } = useSections();
  // null: no dialog; 'new': creating; a section: editing it.
  const [dialog, setDialog] = useState<Section | 'new' | null>(null);
  useEffect(() => {
    void reloadSections(); // fresh note counts
  }, [reloadSections]);
  return (
    <div className="screen">
      <div className="screen-head">
        <h1>Sections</h1>
        <span className="muted">{sections.length === 1 ? '1 section' : `${sections.length} sections`}</span>
      </div>
      <ul className="card-grid section-cards" data-testid="section-cards">
        {sections.map((s) => (
          <li key={s.id} className="card section-card" style={themeVars(s.colour)} aria-label={s.name} data-section={s.id}>
            <div className="section-card-head">
              <SectionSquare name={s.name} />
              <span className="section-card-name">{s.name}</span>
            </div>
            <div className="muted small">
              ID: <code>{s.id}</code>
            </div>
            <div className="muted small" data-testid="section-count">
              {noteCount(s.noteCount)}
            </div>
            <div className="card-actions">
              <button type="button" className="btn btn-sm" aria-label={`Edit ${s.name}`} onClick={() => setDialog(s)}>
                Edit
              </button>
              {s.id === current.id ? (
                <span className="section-current">Current</span>
              ) : (
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  aria-label={`Open ${s.name}`}
                  onClick={() => {
                    setCurrentSection(s.id);
                    navigate('/');
                  }}
                >
                  Open
                </button>
              )}
              <button
                type="button"
                className="btn btn-sm"
                aria-label={`Trash of ${s.name} (${noteCount(s.trashCount)})`}
                title={`Trash of ${s.name}`}
                onClick={() => {
                  setCurrentSection(s.id);
                  navigate('/trash');
                }}
              >
                <Trash2 size={14} /> Trash {s.trashCount}
              </button>
            </div>
          </li>
        ))}
        <li className="card section-card section-new">
          <button type="button" className="btn" onClick={() => setDialog('new')}>
            <Plus size={16} /> New section
          </button>
        </li>
      </ul>
      {dialog && (
        <SectionDialog
          section={dialog === 'new' ? null : dialog}
          onClose={() => setDialog(null)}
          onSaved={async () => {
            await reloadSections();
            setDialog(null);
          }}
        />
      )}
    </div>
  );
}
