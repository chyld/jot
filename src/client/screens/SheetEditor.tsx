// Spreadsheet editor screen, loaded lazily via React.lazy so Univer's bundle is never
// downloaded when working on regular text notes. Reuses Jot's note header (title, tags,
// section, trash, prev/next nav), autosave, read-only lock, and status footer.
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Bot, Check, FileSpreadsheet, List, Lock, LockOpen, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { CommandType, createUniver, defaultTheme, LocaleType, mergeLocales } from '@univerjs/presets';
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core';
import UniverPresetSheetsCoreEnUS from '@univerjs/preset-sheets-core/locales/en-US';
import '@univerjs/preset-sheets-core/lib/index.css';
import { relativeTime, shortDate } from '../../shared/time';
import type { Note, SheetDoc } from '../../shared/types';
import { api } from '../api';
import { useAutosave, type SaveStatus } from '../autosave';
import { NewNoteLink } from '../components/NewNoteLink';
import { useNow } from '../components/NoteCard';
import { NoteSection } from '../components/NoteSection';
import { RailToggleButton } from '../components/Sidebar';
import { TagInput } from '../components/TagInput';
import { setCurrentSection, useSections } from '../currentSection';
import { useData } from '../data';
import { homeHref, navigate } from '../router';

const STATUS_TEXT: Record<SaveStatus, string> = {
  idle: '',
  pending: 'Unsaved changes',
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Not saved',
};

export default function SheetEditor(props: { note: Note; onTrashed: () => void; onChange: (n: Note) => void }) {
  const { user, bumpNotes } = useData();
  const { current } = useSections();
  const note = props.note;
  useEffect(() => {
    if (!note.inbox) setCurrentSection(note.section);
  }, [note.section, note.inbox]);

  const trashed = note.deletedAt !== null;
  const readOnly = note.readOnly;
  const locked = trashed || readOnly;
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const now = useNow();

  const saved = (n: Note) => props.onChange(n);
  const autosave = useAutosave(note.id, saved, user.id, { readOnly });
  const restored = locked ? null : autosave.restored;
  const [title, setTitle] = useState(restored?.title ?? note.title);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmingLock, setConfirmingLock] = useState(false);
  const [newError, setNewError] = useState<string | null>(null);

  useEffect(() => {
    document.title = `${title.trim() || 'Untitled'} · Jot`;
    return () => {
      document.title = 'Jot';
    };
  }, [title]);

  const containerRef = useRef<HTMLDivElement>(null);
  const workbookRef = useRef<ReturnType<ReturnType<typeof createUniver>['univerAPI']['createWorkbook']> | null>(null);
  const initialSheet = (
    restored?.content && typeof restored.content === 'object' && (restored.content as SheetDoc).type === 'sheet'
      ? (restored.content as SheetDoc)
      : (note.content as SheetDoc)
  );
  const lastJsonRef = useRef<string>(JSON.stringify(initialSheet.workbook));
  const scheduleRef = useRef(autosave.schedule);
  scheduleRef.current = autosave.schedule;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let ready = false;
    const { univer, univerAPI } = createUniver({
      locale: LocaleType.EN_US,
      locales: { [LocaleType.EN_US]: mergeLocales(UniverPresetSheetsCoreEnUS) },
      theme: defaultTheme,
      presets: [UniverSheetsCorePreset({ container })],
    });
    const wb = univerAPI.createWorkbook(initialSheet.workbook as any);
    workbookRef.current = wb;
    wb.setEditable(!lockedRef.current);

    // Snapshot once Univer reaches Steady so initial normalization never triggers a spurious save.
    const markReady = () => {
      if (disposed || ready) return;
      try {
        lastJsonRef.current = JSON.stringify(wb.save());
      } catch {
        // ignore if already disposing
      }
      ready = true;
      container.dataset.sheetReady = 'true';
    };

    const syncChanges = () => {
      if (disposed || !ready || lockedRef.current) return;
      try {
        const snapshot = wb.save() as unknown as Record<string, unknown>;
        const nextJson = JSON.stringify(snapshot);
        if (nextJson === lastJsonRef.current) return;
        lastJsonRef.current = nextJson;
        const doc: SheetDoc = { type: 'sheet', version: 1, workbook: snapshot };
        scheduleRef.current({ content: doc });
      } catch {
        // Ignore transient save errors during teardown
      }
    };

    const subs = [
      univerAPI.addEvent(univerAPI.Event.LifeCycleChanged, ({ stage }) => {
        if (stage >= univerAPI.Enum.LifecycleStages.Steady) markReady();
      }),
      univerAPI.addEvent(univerAPI.Event.CommandExecuted, (event) => {
        if (event.type !== CommandType.MUTATION) return;
        syncChanges();
      }),
      univerAPI.addEvent(univerAPI.Event.Undo, syncChanges),
      univerAPI.addEvent(univerAPI.Event.Redo, syncChanges),
    ];

    return () => {
      disposed = true;
      delete container.dataset.sheetReady;
      for (const s of subs) s.dispose();
      workbookRef.current = null;
      // Defer disposal by a microtask so React 19 StrictMode double-mount does not race mount.
      queueMicrotask(() => {
        try {
          univer.dispose();
        } catch {
          // ignore
        }
      });
    };
    // Mount once per note id (NoteEditor keys on noteId).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id]);

  // Keep Univer's editable state in sync when the note is locked or restored from trash.
  useEffect(() => {
    try {
      workbookRef.current?.setEditable(!locked);
    } catch {
      // ignore
    }
  }, [locked]);

  const [sectionOrder, setSectionOrder] = useState<string[] | null>(null);
  const walkable = !trashed && !note.inbox;
  useEffect(() => {
    if (!walkable) {
      setSectionOrder(null);
      return;
    }
    let cancelled = false;
    api.sectionNotes(note.section).then(
      (r) => !cancelled && setSectionOrder(r.notes.map((n) => n.id)),
      () => !cancelled && setSectionOrder(null),
    );
    return () => {
      cancelled = true;
    };
  }, [note.id, note.section, walkable]);

  const sectionSize = sectionOrder ? sectionOrder.length : 0;
  const openNeighbour = async (step: -1 | 1) => {
    if (!sectionOrder || sectionOrder.length < 2) return;
    const i = sectionOrder.indexOf(note.id);
    if (i < 0) return;
    const next = sectionOrder[(i + step + sectionOrder.length) % sectionOrder.length];
    if (next === note.id) return;
    await autosave.flush();
    navigate(`/n/${next}`);
  };

  const tagChange = async (fn: () => Promise<{ note: Note }>) => {
    await autosave.flush();
    const { note: n } = await fn();
    props.onChange(n);
    bumpNotes();
  };

  const moveTo = async (section: string) => {
    setMessage(null);
    try {
      await autosave.flush();
      const { note: n } = await api.moveNote(note.id, section);
      props.onChange(n);
      bumpNotes();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not move the spreadsheet.');
    }
  };

  const makeReadOnly = async () => {
    setMessage(null);
    try {
      await autosave.flush();
      const { note: n } = await api.makeReadOnly(note.id);
      props.onChange(n);
      bumpNotes();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not make the spreadsheet read-only.');
    }
  };

  return (
    <article className={`note sheet-note ${readOnly ? 'is-read-only' : ''}`} data-note-id={note.id} data-note-kind="sheet" aria-label="Spreadsheet">
      <header className="note-header">
        <div className="note-header-nav">
          <RailToggleButton />
          <NewNoteLink className="rail-toggle-btn" label="New note" bump={bumpNotes} onError={setNewError}>
            <Plus size={18} />
          </NewNoteLink>
          <NewNoteLink className="rail-toggle-btn" kind="sheet" label="New spreadsheet" bump={bumpNotes} onError={setNewError}>
            <FileSpreadsheet size={18} />
          </NewNoteLink>
          <a
            href="/"
            className="rail-toggle-btn"
            aria-label="Back to notes"
            title="Back to notes"
            onClick={(e) => {
              if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
              e.preventDefault();
              void autosave.flush().then(() => navigate('/'));
            }}
          >
            <List size={18} />
          </a>
        </div>
        <input
          className="note-title"
          spellCheck={false}
          aria-label="Title"
          placeholder="Untitled spreadsheet"
          value={title}
          readOnly={locked}
          maxLength={500}
          onChange={(e) => {
            setTitle(e.target.value);
            autosave.schedule({ title: e.target.value });
          }}
        />
        <TagInput
          tags={note.tags}
          disabled={locked}
          onOpenTag={(t) => navigate(homeHref(t))}
          onAdd={async (tag) => {
            try {
              await tagChange(() => api.addTag(note.id, tag));
              return null;
            } catch (err) {
              return err instanceof Error ? err.message : 'Could not add the tag.';
            }
          }}
          onRemove={(tag) => void tagChange(() => api.removeTag(note.id, tag)).catch(() => {})}
        />
        <NoteSection section={note.section} disabled={locked} onMove={(s) => void moveTo(s)} />
        <div className="note-meta">
          {note.inbox && !trashed && !readOnly && (
            <button
              type="button"
              className="btn btn-sm btn-primary"
              title={`Move this spreadsheet out of the Inbox into ${current.name}`}
              onClick={async () => {
                setMessage(null);
                try {
                  await autosave.flush();
                  const { note: n } = await api.keep(note.id);
                  props.onChange(n);
                  bumpNotes();
                } catch (err) {
                  setMessage(err instanceof Error ? err.message : 'Could not keep the spreadsheet.');
                }
              }}
            >
              <Check size={14} /> Keep in {current.name}
            </button>
          )}
          {!trashed && (
            <button
              type="button"
              className={`icon-btn ${readOnly ? 'is-active' : ''}`}
              aria-label={readOnly ? 'Read-only' : 'Make read-only'}
              title={readOnly ? 'Read-only: unlock from the command line on the server' : 'Make read-only'}
              disabled={readOnly}
              onClick={() => !readOnly && setConfirmingLock(true)}
            >
              {readOnly ? <Lock size={18} /> : <LockOpen size={18} />}
            </button>
          )}
          {!locked && (
            <button
              type="button"
              className="icon-btn"
              aria-label="Move to trash"
              title="Move to trash"
              onClick={async () => {
                await autosave.flush();
                await api.trashNote(note.id);
                props.onTrashed();
                navigate('/');
              }}
            >
              <Trash2 size={18} />
            </button>
          )}
          {walkable && sectionSize > 1 && (
            <span className="note-nav-buttons">
              <button type="button" className="icon-btn note-nav" aria-label="Previous note" title="Previous note" onClick={() => void openNeighbour(-1)}>
                <ArrowLeft size={16} strokeWidth={2.5} />
              </button>
              <button type="button" className="icon-btn note-nav" aria-label="Next note" title="Next note" onClick={() => void openNeighbour(1)}>
                <ArrowRight size={16} strokeWidth={2.5} />
              </button>
            </span>
          )}
        </div>
      </header>
      {confirmingLock && !readOnly && (
        <div className="banner" role="group" aria-label="Confirm read-only">
          <span>Once read-only, this spreadsheet cannot be edited or deleted in the web app.</span>
          <button
            type="button"
            className="btn btn-sm btn-danger"
            onClick={async () => {
              await makeReadOnly();
              setConfirmingLock(false);
            }}
          >
            Make read-only
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setConfirmingLock(false)}>
            Cancel
          </button>
        </div>
      )}
      {trashed && (
        <div className="banner">
          This spreadsheet is in the trash.
          <button
            type="button"
            className="btn btn-sm"
            onClick={async () => {
              const { note: n } = await api.restore(note.id);
              props.onChange(n);
              props.onTrashed();
            }}
          >
            <RotateCcw size={14} /> Restore
          </button>
        </div>
      )}
      {newError && (
        <div className="banner banner-error" role="alert">
          {newError}
        </div>
      )}
      {autosave.error ? (
        <div className="banner banner-error" role="alert" data-testid="save-error">
          {autosave.error}
        </div>
      ) : (
        restored &&
        autosave.status !== 'saved' && (
          <div className="banner" role="status">
            Changes that had not reached the server were kept in this browser and put back. Saving them now.
          </div>
        )
      )}
      {message && (
        <div className="banner banner-error" role="alert">
          {message}
        </div>
      )}
      <div className="sheet-host" data-testid="sheet-editor" ref={containerRef} />
      <footer className="note-status" aria-label="Note status">
        <span className="sheet-kind-badge">
          <FileSpreadsheet size={12} /> Spreadsheet
        </span>
        <span data-testid="save-status" className={`save-status status-${autosave.status}`} role="status">
          {STATUS_TEXT[autosave.status]}
        </span>
        {readOnly && (
          <span className="read-only-badge" data-testid="read-only-indicator" title="This spreadsheet is read-only. It can only be made writable again from the command line on the server.">
            <Lock size={12} /> Read-only
          </span>
        )}
        {note.botName && (
          <span className="bot-badge" data-testid="note-bot" title={`Written by the bot ${note.botName}`}>
            <Bot size={12} /> From {note.botName}
          </span>
        )}
        <span className="note-dates" data-testid="note-dates">
          <span className="note-created">Created {shortDate(note.createdAt)} ·</span>{' '}
          <span>Updated {relativeTime(note.updatedAt, now)}</span>
        </span>
      </footer>
    </article>
  );
}
