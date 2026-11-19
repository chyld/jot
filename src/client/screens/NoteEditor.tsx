import { useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import type { Editor } from '@tiptap/core';
import { RotateCcw, Trash2 } from 'lucide-react';
import { relativeTime, shortDate } from '../../shared/time';
import type { StyleInput } from '../../shared/styles';
import type { Note } from '../../shared/types';
import { api, ApiError } from '../api';
import { useAutosave, type SaveStatus } from '../autosave';
import { useNow } from '../components/NoteCard';
import { blankStyle, StyleDialog } from '../components/StyleDialog';
import { TagInput } from '../components/TagInput';
import { useData } from '../data';
import { jotExtensions } from '../editor/extensions';
import { pasteProps, PHOTO_TYPE_MESSAGE, PHOTO_TYPES } from '../editor/paste';
import { currentFormat } from '../editor/stamp';
import { Toolbar } from '../editor/Toolbar';
import { takeNewNote } from '../newNotes';
import { homeHref, navigate } from '../router';

const STATUS_TEXT: Record<SaveStatus, string> = {
  idle: '',
  pending: 'Unsaved changes',
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Not saved',
};

export function NoteEditor(props: { noteId: string; onTrashed: () => void }) {
  const [note, setNote] = useState<Note | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let cancelled = false;
    api.note(props.noteId).then(
      (r) => !cancelled && setNote(r.note),
      (err) => !cancelled && err instanceof ApiError && err.status === 404 && setMissing(true),
    );
    return () => {
      cancelled = true;
    };
  }, [props.noteId]);
  if (missing)
    return (
      <div className="empty-state">
        <p>This note does not exist.</p>
        <a href="/" onClick={(e) => (e.preventDefault(), navigate('/'))}>
          Back to all notes
        </a>
      </div>
    );
  if (!note) return <div className="empty-state muted">Loading…</div>;
  return <LoadedNote note={note} onTrashed={props.onTrashed} onChange={setNote} />;
}

function LoadedNote(props: { note: Note; onTrashed: () => void; onChange: (n: Note) => void }) {
  const { fonts, styles, reloadStyles, user } = useData();
  const note = props.note;
  const trashed = note.deletedAt !== null;
  const now = useNow();
  const saved = (n: Note) => props.onChange(n);
  // Edits this browser kept because the server never confirmed them come back here.
  const autosave = useAutosave(note.id, saved, user.id);
  const restored = trashed ? null : autosave.restored;
  const [title, setTitle] = useState(restored?.title ?? note.title);
  const [styleDraft, setStyleDraft] = useState<StyleInput | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // A pasted image goes through the same upload as Insert → Image (set below, once pickImage exists).
  const pasteFile = useRef<(file: File) => void>(() => {});
  const editor = useEditor({
    extensions: jotExtensions(),
    // Pasted text is plain text: no Markdown-style or link rules on paste.
    enablePasteRules: false,
    content: (restored?.content as Note['content'] | undefined) ?? note.content,
    editable: !trashed,
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: { class: 'note-body', 'aria-label': 'Note text', spellcheck: 'true' },
      ...pasteProps((file) => pasteFile.current(file)),
    },
    onUpdate: ({ editor }) => autosave.schedule({ content: editor.getJSON() }),
  });

  useEffect(() => {
    if (editor && editor.isEditable === trashed) editor.setEditable(!trashed);
  }, [editor, trashed]);

  // A note just made with a New button: the caret goes into the body as soon as the
  // editor holds this note, so typing starts there without a click. Existing notes are
  // opened as before.
  useEffect(() => {
    if (editor && !trashed && takeNewNote(note.id)) editor.commands.focus('end');
  }, [editor, note.id, trashed]);

  const saveSelectionAsStyle = (ed: Editor) => {
    const fmt = currentFormat(ed);
    const base = blankStyle(fonts);
    const font = fonts.find((f) => f.family === fmt.fontFamily);
    setStyleDraft({
      ...base,
      fontId: font?.id ?? base.fontId,
      size: fmt.size ?? base.size,
      bold: fmt.bold,
      italic: fmt.italic,
      underline: fmt.underline,
      strike: fmt.strike,
      textColor: fmt.textColor,
      highlight: fmt.highlight,
    });
  };

  const pickImage = async (file: File) => {
    setMessage(null);
    try {
      const { photo } = await api.uploadPhoto(file);
      editor?.chain().focus().setImage({ src: photo.url }).run();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not upload the photo.');
    }
  };

  pasteFile.current = (file: File) => {
    if (!PHOTO_TYPES.includes(file.type)) setMessage(PHOTO_TYPE_MESSAGE);
    else void pickImage(file);
  };

  const tagChange = async (fn: () => Promise<{ note: Note }>) => {
    await autosave.flush();
    const { note: n } = await fn();
    saved(n);
  };

  return (
    <article className="note" aria-label="Note" data-note-id={note.id}>
      <header className="note-header">
        <input
          className="note-title"
          aria-label="Title"
          placeholder="Untitled"
          value={title}
          readOnly={trashed}
          maxLength={500}
          onChange={(e) => {
            setTitle(e.target.value);
            autosave.schedule({ title: e.target.value });
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              editor?.commands.focus('start');
            }
          }}
        />
        <TagInput
          tags={note.tags}
          disabled={trashed}
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
        <div className="note-meta">
          <span data-testid="save-status" className={`save-status status-${autosave.status}`} role="status">
            {STATUS_TEXT[autosave.status]}
          </span>
          <span className="note-dates" data-testid="note-dates">
            Created {shortDate(note.createdAt)} · Updated {relativeTime(note.updatedAt, now)}
          </span>
          {!trashed && (
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
        </div>
      </header>
      {trashed && (
        <div className="banner">
          This note is in the trash.
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
      {editor && !trashed && (
        <Toolbar
          editor={editor}
          styles={styles}
          fonts={fonts}
          onSaveSelectionAsStyle={() => saveSelectionAsStyle(editor)}
          onManageStyles={() => navigate('/styles')}
          onBrowseFonts={() => navigate('/fonts')}
          onPickImage={(f) => void pickImage(f)}
        />
      )}
      <div className="note-scroll">
        <EditorContent editor={editor} className="note-content" />
      </div>
      {styleDraft && (
        <StyleDialog
          title="Save selection as style"
          initial={styleDraft}
          fonts={fonts}
          onClose={() => setStyleDraft(null)}
          onSave={async (input) => {
            await api.createStyle(input);
            await reloadStyles();
            setStyleDraft(null);
          }}
        />
      )}
    </article>
  );
}
