// Whiteboard editor screen, loaded lazily via React.lazy so Excalidraw's bundle is never
// downloaded when working on regular documents or spreadsheets. Reuses Jot's note header
// (title, tags, section, lock, trash, prev/next nav), autosave, and status footer.
import '../boardAssetPath';
import '@excalidraw/excalidraw/index.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Bot, Check, FileText, List, Lock, LockOpen, PenTool, RotateCcw, Sheet, Trash2 } from 'lucide-react';
import { Excalidraw, hashElementsVersion, MainMenu } from '@excalidraw/excalidraw';
import { MAX_TITLE_LENGTH } from '../../shared/constants';
import { relativeTime, shortDate } from '../../shared/time';
import type { BoardDoc, Note } from '../../shared/types';
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

/** Coalesce bursts of Excalidraw pointer/drag updates before scheduling autosave. */
const CAPTURE_DEBOUNCE_MS = 150;

const BOARD_UI_OPTIONS = {
  canvasActions: {
    loadScene: false,
    saveToActiveFile: false,
    export: false,
    saveAsImage: true,
    toggleTheme: false,
    changeViewBackgroundColor: true,
    clearCanvas: true,
  },
  tools: {
    image: false,
  },
} as const;

type ExcalidrawAPI = {
  getSceneElements: () => readonly Record<string, unknown>[];
  getAppState: () => Record<string, unknown>;
};

function pickDurableAppState(appState: Record<string, unknown> | undefined | null): Record<string, unknown> {
  const out: Record<string, unknown> = {
    viewBackgroundColor: typeof appState?.viewBackgroundColor === 'string' ? appState.viewBackgroundColor : '#ffffff',
  };
  if (appState?.gridSize !== undefined) out.gridSize = appState.gridSize;
  if (appState?.gridStep !== undefined) out.gridStep = appState.gridStep;
  if (typeof appState?.gridModeEnabled === 'boolean') out.gridModeEnabled = appState.gridModeEnabled;
  return out;
}

function sceneSignature(elements: readonly Record<string, unknown>[], appState: Record<string, unknown>): string {
  const live = elements.filter((el) => el && el.isDeleted !== true);
  const versionHash = hashElementsVersion(live as any);
  return `${versionHash}|${JSON.stringify(pickDurableAppState(appState))}`;
}

function toBoardDoc(elements: readonly Record<string, unknown>[], appState: Record<string, unknown>): BoardDoc {
  const live = elements.filter((el) => el && el.isDeleted !== true) as Array<Record<string, unknown>>;
  return {
    type: 'board',
    version: 1,
    elements: live,
    appState: pickDurableAppState(appState),
    files: {},
  };
}

export default function BoardEditor(props: { note: Note; onTrashed: () => void; onChange: (n: Note) => void }) {
  const { user, bumpNotes } = useData();
  const { current } = useSections();
  const note = props.note;
  const noteRef = useRef(note);
  noteRef.current = note;
  useEffect(() => {
    if (!note.inbox) setCurrentSection(note.section);
  }, [note.section, note.inbox]);

  const [confirmingLock, setConfirmingLock] = useState(false);
  const [lockBusy, setLockBusy] = useState(false);
  const [newError, setNewError] = useState<string | null>(null);
  const trashed = note.deletedAt !== null;
  const readOnly = note.readOnly;
  const locked = trashed || readOnly || lockBusy;
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const now = useNow();

  const hostRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<ExcalidrawAPI | null>(null);
  const captureTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushCaptureRef = useRef<() => void>(() => {});

  // PATCH ?summary=1 omits the content blob; merge metadata over the live note.
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
      flushCaptureRef.current();
    },
  });
  const restored = locked ? null : autosave.restored;
  const [title, setTitle] = useState(restored?.title ?? note.title);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    document.title = `${title.trim() || 'Untitled'} · Jot`;
    return () => {
      document.title = 'Jot';
    };
  }, [title]);

  const scheduleRef = useRef(autosave.schedule);
  scheduleRef.current = autosave.schedule;

  // Snapshot the initial scene once per note id so Excalidraw does not reset on metadata re-renders.
  const initialData = useMemo(() => {
    const raw =
      restored?.content && typeof restored.content === 'object' && (restored.content as BoardDoc).type === 'board'
        ? (restored.content as BoardDoc)
        : (note.content as BoardDoc);
    const elements = Array.isArray(raw?.elements) ? raw.elements : [];
    const appState = pickDurableAppState(raw?.appState);
    return {
      elements: elements as any,
      appState: appState as any,
      files: {},
      scrollToContent: elements.length > 0,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id]);

  const initialSig = useMemo(() => sceneSignature(initialData.elements, initialData.appState), [initialData]);
  const baselineSigRef = useRef<string>(initialSig);
  const lastScheduledSigRef = useRef<string>(initialSig);
  const mountedSettledRef = useRef(false);

  useEffect(() => {
    if (locked && captureTimerRef.current) {
      clearTimeout(captureTimerRef.current);
      captureTimerRef.current = null;
    }
  }, [locked]);

  const commitTextEditSync = useCallback(() => {
    const host = hostRef.current;
    const active = document.activeElement;
    if (host && active instanceof HTMLTextAreaElement && host.contains(active)) {
      active.blur();
    }
  }, []);

  const captureFromApiNow = useCallback(() => {
    if (captureTimerRef.current) {
      clearTimeout(captureTimerRef.current);
      captureTimerRef.current = null;
    }
    if (lockedRef.current) return;
    commitTextEditSync();
    const exApi = apiRef.current;
    if (!exApi) return;
    try {
      const elements = exApi.getSceneElements();
      const appState = exApi.getAppState();
      const sig = sceneSignature(elements, appState);
      if (sig === lastScheduledSigRef.current) return;
      lastScheduledSigRef.current = sig;
      baselineSigRef.current = sig;
      scheduleRef.current({ content: toBoardDoc(elements, appState) });
    } catch {
      // Ignore transient teardown errors
    }
  }, [commitTextEditSync]);

  flushCaptureRef.current = captureFromApiNow;

  useEffect(() => {
    return () => {
      flushCaptureRef.current();
      if (captureTimerRef.current) {
        clearTimeout(captureTimerRef.current);
        captureTimerRef.current = null;
      }
    };
  }, [note.id]);

  const handleApi = useCallback((api: unknown) => {
    apiRef.current = api as ExcalidrawAPI;
    if (hostRef.current) hostRef.current.dataset.boardReady = 'true';
  }, []);

  const handleChange = useCallback((elements: readonly any[], appState: any) => {
    const sig = sceneSignature(elements, appState);
    if (!mountedSettledRef.current) {
      mountedSettledRef.current = true;
      // Absorb initial mount/normalization without marking a freshly opened board dirty.
      baselineSigRef.current = sig;
      lastScheduledSigRef.current = sig;
      return;
    }
    if (lockedRef.current || sig === baselineSigRef.current) return;
    baselineSigRef.current = sig;
    if (captureTimerRef.current) clearTimeout(captureTimerRef.current);
    captureTimerRef.current = setTimeout(() => {
      captureTimerRef.current = null;
      if (lockedRef.current) return;
      const exApi = apiRef.current;
      const latestElements = exApi ? exApi.getSceneElements() : elements;
      const latestAppState = exApi ? exApi.getAppState() : appState;
      const latestSig = sceneSignature(latestElements, latestAppState);
      if (latestSig === lastScheduledSigRef.current) return;
      lastScheduledSigRef.current = latestSig;
      baselineSigRef.current = latestSig;
      scheduleRef.current({ content: toBoardDoc(latestElements, latestAppState) });
    }, CAPTURE_DEBOUNCE_MS);
  }, []);

  const commitAndFlush = useCallback(async () => {
    captureFromApiNow();
    await autosave.flush();
  }, [captureFromApiNow, autosave]);

  // Previous / Next walk the section in fresh home page order, matching NoteEditor and SheetEditor.
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
      setMessage(err instanceof Error ? err.message : 'Could not move the whiteboard.');
    }
  };

  const makeReadOnly = async () => {
    setMessage(null);
    setLockBusy(true);
    try {
      await commitAndFlush();
      lockedRef.current = true;
      if (captureTimerRef.current) {
        clearTimeout(captureTimerRef.current);
        captureTimerRef.current = null;
      }
      const { note: n } = await api.makeReadOnly(note.id);
      props.onChange(n);
      bumpNotes();
      setConfirmingLock(false);
    } catch (err) {
      lockedRef.current = false;
      setMessage(err instanceof Error ? err.message : 'Could not make the whiteboard read-only.');
    } finally {
      setLockBusy(false);
    }
  };

  return (
    <article className={`note board-note ${readOnly ? 'is-read-only' : ''}`} data-note-id={note.id} data-note-kind="board" aria-label="Whiteboard">
      <header className="note-header">
        <div className="note-header-actions">
          <RailToggleButton />
          <NewNoteLink className="rail-toggle-btn" label="New note" bump={bumpNotes} onError={setNewError}>
            <FileText size={18} />
          </NewNoteLink>
          <NewNoteLink className="rail-toggle-btn" kind="sheet" label="New spreadsheet" bump={bumpNotes} onError={setNewError}>
            <Sheet size={18} />
          </NewNoteLink>
          <NewNoteLink className="rail-toggle-btn" kind="board" label="New whiteboard" bump={bumpNotes} onError={setNewError}>
            <PenTool size={18} />
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
          placeholder="Untitled whiteboard"
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
              title={`Move this whiteboard out of the Inbox into ${current.name}`}
              onClick={async () => {
                setMessage(null);
                try {
                  await commitAndFlush();
                  const { note: n } = await api.keep(note.id);
                  props.onChange(n);
                  bumpNotes();
                } catch (err) {
                  setMessage(err instanceof Error ? err.message : 'Could not keep the whiteboard.');
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
                  setMessage(err instanceof Error ? err.message : 'Could not move the whiteboard to the trash.');
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
            Once read-only, this whiteboard cannot be edited or deleted in the web app. Unlock it later from the server with <code>jot unlock-note {note.id}</code>.
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
          This whiteboard is in the trash.
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
                setMessage(err instanceof Error ? err.message : 'Could not restore the whiteboard.');
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
          This whiteboard is too large to keep a backup copy in browser storage; wait for “Saved” before closing the tab.
        </div>
      )}
      {message && (
        <div className="banner banner-error" role="alert">
          {message}
        </div>
      )}
      <div
        className="board-host"
        data-testid="board-editor"
        role="region"
        aria-label="Whiteboard canvas"
        ref={hostRef}
        onDropCapture={(e) => {
          if (e.dataTransfer?.files?.length) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
      >
        <Excalidraw
          excalidrawAPI={handleApi}
          initialData={initialData}
          onChange={handleChange}
          viewModeEnabled={locked}
          theme="light"
          aiEnabled={false}
          validateEmbeddable={false}
          UIOptions={BOARD_UI_OPTIONS}
        >
          <MainMenu>
            <MainMenu.DefaultItems.SaveAsImage />
            {!locked && <MainMenu.DefaultItems.ClearCanvas />}
            {!locked && <MainMenu.DefaultItems.ChangeCanvasBackground />}
            <MainMenu.DefaultItems.Help />
          </MainMenu>
        </Excalidraw>
      </div>
      <footer className="note-status" aria-label="Note status">
        <span className="board-kind-badge">
          <PenTool size={12} /> Whiteboard
        </span>
        <span data-testid="save-status" className={`save-status status-${autosave.status}`} role="status">
          {STATUS_TEXT[autosave.status]}
        </span>
        {readOnly && (
          <span className="read-only-badge" data-testid="read-only-indicator" title="This whiteboard is read-only. It can only be made writable again from the command line on the server.">
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
