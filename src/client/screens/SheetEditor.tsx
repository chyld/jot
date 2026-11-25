// Spreadsheet editor screen, loaded lazily via React.lazy so Univer's bundle is never
// downloaded when working on regular text notes. Reuses Jot's note header (title, tags,
// section, trash, prev/next nav), autosave, read-only lock, and status footer.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Bot, Check, FileText, List, Lock, LockOpen, RotateCcw, Sheet, Trash2 } from 'lucide-react';
import { CommandType, createUniver, defaultTheme, LocaleType, mergeLocales } from '@univerjs/presets';
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core';
import UniverPresetSheetsCoreEnUS from '@univerjs/preset-sheets-core/locales/en-US';
import '@univerjs/preset-sheets-core/lib/index.css';
import { MAX_TITLE_LENGTH } from '../../shared/constants';
import { relativeTime, shortDate } from '../../shared/time';
import type { Font, Note, SheetDoc } from '../../shared/types';
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

const VALID_FONT_CATEGORIES = new Set(['sans-serif', 'serif', 'monospace', 'display', 'handwriting']);
/** Coalesce bursts of Univer mutations before serializing the workbook snapshot. */
const CAPTURE_DEBOUNCE_MS = 120;

function toUniverFonts(fonts: Font[]) {
  const active = fonts.filter((f) => !f.archived);
  const ordered = [...active.filter((f) => !f.isDefault), ...active.filter((f) => f.isDefault)];
  return ordered.map((f) => ({
    value: f.family,
    label: f.family,
    ...(VALID_FONT_CATEGORIES.has(f.category) ? { category: f.category as any } : {}),
  }));
}

export default function SheetEditor(props: { note: Note; onTrashed: () => void; onChange: (n: Note) => void }) {
  const { user, fonts, fontsLoaded, bumpNotes } = useData();
  const { current } = useSections();
  const note = props.note;
  const noteRef = useRef(note);
  noteRef.current = note;
  useEffect(() => {
    if (!note.inbox) setCurrentSection(note.section);
  }, [note.section, note.inbox]);

  const trashed = note.deletedAt !== null;
  const readOnly = note.readOnly;
  const locked = trashed || readOnly;
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const now = useNow();

  const containerRef = useRef<HTMLDivElement>(null);
  const workbookRef = useRef<ReturnType<ReturnType<typeof createUniver>['univerAPI']['createWorkbook']> | null>(null);
  const flushCaptureRef = useRef<() => void>(() => {});
  const commitEditingSyncRef = useRef<() => void>(() => {});

  // PATCH ?summary=1 omits the multi-MB content blob; merge metadata over the live note.
  const saved = useCallback(
    (summaryOrFull: Note) => {
      const merged = summaryOrFull.content !== undefined ? summaryOrFull : { ...noteRef.current, ...summaryOrFull };
      props.onChange(merged);
    },
    [props.onChange],
  );
  const autosave = useAutosave(note.id, saved, user.id, {
    readOnly,
    summary: true,
    onBeforeUnload: () => {
      commitEditingSyncRef.current();
      flushCaptureRef.current();
    },
  });
  const restored = locked ? null : autosave.restored;
  const [title, setTitle] = useState(restored?.title ?? note.title);
  const [message, setMessage] = useState<string | null>(null);
  const [mountError, setMountError] = useState<string | null>(null);
  const [confirmingLock, setConfirmingLock] = useState(false);
  const [lockBusy, setLockBusy] = useState(false);
  const [newError, setNewError] = useState<string | null>(null);

  useEffect(() => {
    document.title = `${title.trim() || 'Untitled'} · Jot`;
    return () => {
      document.title = 'Jot';
    };
  }, [title]);

  const initialSheet = (
    restored?.content && typeof restored.content === 'object' && (restored.content as SheetDoc).type === 'sheet'
      ? (restored.content as SheetDoc)
      : (note.content as SheetDoc)
  );
  const lastJsonRef = useRef<string>(JSON.stringify(initialSheet.workbook));
  const scheduleRef = useRef(autosave.schedule);
  scheduleRef.current = autosave.schedule;
  const fontsRef = useRef(fonts);
  fontsRef.current = fonts;

  // Warm-load all user @font-face files (including archived fonts used by older sheets, plus bold/italic faces)
  // so Univer's canvas grid renders them immediately and its font picker recognises them as supported.
  useEffect(() => {
    if (!fontsLoaded || typeof document.fonts?.load !== 'function') return;
    for (const f of fonts) {
      const family = `"${f.family}"`;
      void document.fonts.load(`400 12px ${family}`).catch(() => {});
      void document.fonts.load(`700 12px ${family}`).catch(() => {});
      void document.fonts.load(`italic 12px ${family}`).catch(() => {});
    }
  }, [fonts, fontsLoaded]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !fontsLoaded) return;
    let disposed = false;
    let ready = false;
    let workbookCreated = false;
    let userEditedBeforeReady = false;
    let captureDirty = false;
    let captureTimer: ReturnType<typeof setTimeout> | null = null;
    setMountError(null);

    // Give each effect run its own isolated child element so React 19 StrictMode double-mount
    // disposal cannot tear down the second mount's DOM root.
    const mountEl = document.createElement('div');
    mountEl.className = 'sheet-mount';
    container.append(mountEl);

    let univer: ReturnType<typeof createUniver>['univer'] | null = null;
    const subs: Array<{ dispose: () => void }> = [];

    try {
      const customFonts = toUniverFonts(fontsRef.current);
      const created = createUniver({
        locale: LocaleType.EN_US,
        locales: { [LocaleType.EN_US]: mergeLocales(UniverPresetSheetsCoreEnUS) },
        theme: defaultTheme,
        presets: [
          UniverSheetsCorePreset({
            container: mountEl,
            ...(customFonts.length > 0 ? { customFontFamily: { override: true, list: customFonts } } : {}),
          }),
        ],
      });
      univer = created.univer;
      const univerAPI = created.univerAPI;

      let wb: ReturnType<typeof univerAPI.createWorkbook> | null = null;

      const captureNow = () => {
        if (captureTimer) {
          clearTimeout(captureTimer);
          captureTimer = null;
        }
        if (disposed || !wb || lockedRef.current) return;
        captureDirty = false;
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

      const scheduleCapture = () => {
        if (disposed || lockedRef.current) return;
        captureDirty = true;
        if (captureTimer) clearTimeout(captureTimer);
        captureTimer = setTimeout(() => {
          captureTimer = null;
          if (captureDirty) captureNow();
        }, CAPTURE_DEBOUNCE_MS);
      };

      const markReady = () => {
        if (disposed || ready || !wb) return;
        ready = true;
        container.dataset.sheetReady = 'true';
        if (userEditedBeforeReady) {
          // A real user edit happened before Rendered/Steady — persist it instead of absorbing it into the baseline.
          captureNow();
        } else {
          try {
            lastJsonRef.current = JSON.stringify(wb.save());
          } catch {
            // ignore if already disposing
          }
        }
      };

      const commitEditingSync = () => {
        try {
          const active = wb as { isCellEditing?: () => boolean; endEditingAsync?: (save: boolean) => Promise<unknown> } | null;
          if (active?.isCellEditing?.()) {
            // endEditingAsync synchronously dispatches SetCellEditVisibleOperation before returning a Promise.
            void active.endEditingAsync?.(true);
          }
        } catch {
          // ignore
        }
      };

      commitEditingSyncRef.current = commitEditingSync;
      flushCaptureRef.current = () => {
        if (captureDirty || userEditedBeforeReady) captureNow();
      };

      // Subscribe BEFORE createWorkbook so synchronous lifecycle transitions are never missed.
      let reachedRendered = false;
      subs.push(
        univerAPI.addEvent(univerAPI.Event.LifeCycleChanged, ({ stage }) => {
          if (stage >= univerAPI.Enum.LifecycleStages.Rendered) {
            reachedRendered = true;
            if (wb) markReady();
          }
        }),
        univerAPI.addEvent(univerAPI.Event.CommandExecuted, (event) => {
          if (disposed || !workbookCreated || lockedRef.current) return;
          if (!ready) {
            // Track any user-initiated command before Rendered so early edits are never lost.
            if (event.type === CommandType.COMMAND) userEditedBeforeReady = true;
            return;
          }
          if (event.type !== CommandType.MUTATION) return;
          scheduleCapture();
        }),
        univerAPI.addEvent(univerAPI.Event.Undo, () => {
          if (!ready) {
            userEditedBeforeReady = true;
            return;
          }
          scheduleCapture();
        }),
        univerAPI.addEvent(univerAPI.Event.Redo, () => {
          if (!ready) {
            userEditedBeforeReady = true;
            return;
          }
          scheduleCapture();
        }),
      );

      wb = univerAPI.createWorkbook(initialSheet.workbook as any);
      workbookCreated = true;
      workbookRef.current = wb;
      wb.setEditable(!lockedRef.current);

      if (reachedRendered || univerAPI.getCurrentLifecycleStage() >= univerAPI.Enum.LifecycleStages.Rendered) {
        markReady();
      }
    } catch (err) {
      setMountError(err instanceof Error ? err.message : 'Could not open this spreadsheet.');
    }

    return () => {
      if (!lockedRef.current) {
        commitEditingSyncRef.current();
        flushCaptureRef.current();
      }
      disposed = true;
      if (captureTimer) clearTimeout(captureTimer);
      delete container.dataset.sheetReady;
      for (const s of subs) s.dispose();
      workbookRef.current = null;
      flushCaptureRef.current = () => {};
      commitEditingSyncRef.current = () => {};
      mountEl.remove();
      const toDispose = univer;
      if (toDispose) {
        queueMicrotask(() => {
          try {
            toDispose.dispose();
          } catch {
            // ignore
          }
        });
      }
    };
    // Mount once per note id once the fonts request has settled (NoteEditor keys on noteId).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id, fontsLoaded]);

  // Keep Univer's editable state in sync when the note is locked or restored from trash.
  useEffect(() => {
    try {
      workbookRef.current?.setEditable(!locked);
    } catch {
      // ignore
    }
  }, [locked]);

  const commitAndFlush = useCallback(async () => {
    try {
      const wb = workbookRef.current as { isCellEditing?: () => boolean; endEditingAsync?: (save: boolean) => Promise<unknown> } | null;
      if (wb?.isCellEditing?.()) {
        await wb.endEditingAsync?.(true);
      }
    } catch {
      // ignore
    }
    flushCaptureRef.current();
    await autosave.flush();
  }, [autosave]);

  // Previous / Next walk the section in fresh home page order, matching NoteEditor.tsx.
  const [sectionSize, setSectionSize] = useState(0);
  const walkable = !trashed && !note.inbox;
  useEffect(() => {
    if (!walkable) {
      setSectionSize(0);
      return;
    }
    let cancelled = false;
    api.sectionNotes(note.section).then(
      (r) => !cancelled && setSectionSize(r.notes.length),
      () => !cancelled && setSectionSize(0),
    );
    return () => {
      cancelled = true;
    };
  }, [note.section, walkable]);

  const openNeighbour = async (step: -1 | 1) => {
    setMessage(null);
    try {
      await commitAndFlush();
      const list = (await api.sectionNotes(note.section)).notes;
      const i = list.findIndex((n) => n.id === note.id);
      if (i < 0 || list.length < 2) return;
      navigate(`/n/${list[(i + step + list.length) % list.length].id}`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not open the note.');
    }
  };

  const tagChange = async (fn: () => Promise<{ note: Note }>) => {
    await commitAndFlush();
    const { note: n } = await fn();
    props.onChange(n);
    bumpNotes();
  };

  const moveTo = async (section: string) => {
    setMessage(null);
    try {
      await commitAndFlush();
      const { note: n } = await api.moveNote(note.id, section);
      props.onChange(n);
      bumpNotes();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not move the spreadsheet.');
    }
  };

  const makeReadOnly = async () => {
    setMessage(null);
    setLockBusy(true);
    try {
      await commitAndFlush();
      const { note: n } = await api.makeReadOnly(note.id);
      props.onChange(n);
      bumpNotes();
      setConfirmingLock(false);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not make the spreadsheet read-only.');
    } finally {
      setLockBusy(false);
    }
  };

  return (
    <article className={`note sheet-note ${readOnly ? 'is-read-only' : ''}`} data-note-id={note.id} data-note-kind="sheet" aria-label="Spreadsheet">
      <header className="note-header">
        <div className="note-header-actions">
          <RailToggleButton />
          <NewNoteLink className="rail-toggle-btn" label="New note" bump={bumpNotes} onError={setNewError}>
            <FileText size={18} />
          </NewNoteLink>
          <NewNoteLink className="rail-toggle-btn" kind="sheet" label="New spreadsheet" bump={bumpNotes} onError={setNewError}>
            <Sheet size={18} />
          </NewNoteLink>
          <a
            href="/"
            className="rail-toggle-btn"
            aria-label="Back to notes"
            title="Back to notes"
            onClick={(e) => {
              if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
              e.preventDefault();
              void commitAndFlush().then(() => navigate('/'));
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
          maxLength={MAX_TITLE_LENGTH}
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
                  await commitAndFlush();
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
              aria-pressed={readOnly}
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
                setMessage(null);
                try {
                  await commitAndFlush();
                  await api.trashNote(note.id);
                  props.onTrashed();
                  navigate('/');
                } catch (err) {
                  setMessage(err instanceof Error ? err.message : 'Could not move the spreadsheet to the trash.');
                }
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
        <div className="readonly-confirm" role="group" aria-label="Confirm read-only">
          <span>
            Once read-only, this spreadsheet cannot be edited or deleted in the web app. Unlock it later from the server with <code>jot unlock-note {note.id}</code>.
          </span>
          <button type="button" className="btn btn-sm btn-danger" disabled={lockBusy} onClick={() => void makeReadOnly()}>
            Make read-only
          </button>
          <button type="button" className="btn btn-sm" disabled={lockBusy} onClick={() => setConfirmingLock(false)}>
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
              setMessage(null);
              try {
                const { note: n } = await api.restore(note.id);
                props.onChange(n);
                props.onTrashed();
              } catch (err) {
                setMessage(err instanceof Error ? err.message : 'Could not restore the spreadsheet.');
              }
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
      {autosave.storageWarning && !autosave.error && (
        <div className="banner" role="status">
          This spreadsheet is too large to keep a backup copy in browser storage; wait for “Saved” before closing the tab.
        </div>
      )}
      {message && (
        <div className="banner banner-error" role="alert">
          {message}
        </div>
      )}
      {mountError ? (
        <div className="empty-state" role="alert">
          <p>Could not open this spreadsheet: {mountError}</p>
          <button type="button" className="btn" onClick={() => window.location.reload()}>
            Reload page
          </button>
        </div>
      ) : (
        <div className="sheet-host" data-testid="sheet-editor" role="region" aria-label="Spreadsheet grid" ref={containerRef} />
      )}
      <footer className="note-status" aria-label="Note status">
        <span className="sheet-kind-badge">
          <Sheet size={12} /> Spreadsheet
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
