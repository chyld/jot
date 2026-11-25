// Saves note edits shortly after the user stops typing. Saves for one note are
// strictly sequential. Until the server confirms an edit it is also kept in this
// browser (unsaved.ts), so it survives a failed save, a closed tab or a reload; a
// failed save is retried automatically while the failure is temporary, and the editor
// shows a clear "not saved" warning until a save succeeds.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Note } from '../shared/types';
import { api, ApiError } from './api';
import { clearUnsaved, loadUnsaved, storeUnsaved, type UnsavedPatch } from './unsaved';

export type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';
type Patch = UnsavedPatch;

export const AUTOSAVE_DELAY_MS = 600;
/** Waits between automatic retries of a failed save (the last one repeats). */
export const RETRY_DELAYS_MS = [2000, 5000, 10000, 30000];

const isEmpty = (p: Patch) => Object.keys(p).length === 0;

/** Network failures, server errors and "a restore is running" pass; a missing note or a refused edit does not. */
function isTemporary(err: unknown): boolean {
  if (!(err instanceof ApiError)) return true;
  if (err.status >= 500 || err.status === 429) return true;
  return err.status === 409 && (err.code === 'restore-in-progress' || err.code === 'busy');
}

function describe(err: unknown): string {
  if (err instanceof ApiError && err.status === 404) {
    return 'Not saved: this note no longer exists on the server (a restore may have replaced it). Your text is still here; copy it to keep it.';
  }
  if (err instanceof ApiError && err.code === 'restore-in-progress') return 'Not saved yet: a restore of your data is in progress. Jot will try again.';
  const why = err instanceof Error && err.message ? err.message.replace(/\.$/, '') : 'the save failed';
  return isTemporary(err)
    ? `Not saved yet (${why}). Your changes are kept in this browser and Jot keeps trying.`
    : `Not saved: ${why}.`;
}

export function useAutosave(noteId: string, onSaved: (note: Note) => void, userId: string, opts: { readOnly?: boolean } = {}) {
  // Edits from an earlier visit that the server never confirmed come back first; a
  // read-only note can never take them, so they are dropped.
  const [restored] = useState(() => {
    if (opts.readOnly) {
      clearUnsaved(userId, noteId);
      return null;
    }
    return loadUnsaved(userId, noteId);
  });
  const pending = useRef<Patch>(restored ? { ...restored } : {});
  const inflight = useRef<Patch>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attempts = useRef(0);
  const mounted = useRef(true);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  const [status, setStatus] = useState<SaveStatus>(restored ? 'pending' : 'idle');
  const [error, setError] = useState<string | null>(null);

  /** Mirrors everything not yet confirmed into this browser's storage. */
  const persist = useCallback(() => {
    const all = { ...inflight.current, ...pending.current };
    if (isEmpty(all)) clearUnsaved(userId, noteId);
    else storeUnsaved(userId, noteId, all);
  }, [noteId, userId]);

  const flush = useCallback((): Promise<void> => {
    if (timer.current) clearTimeout(timer.current);
    if (retryTimer.current) clearTimeout(retryTimer.current);
    timer.current = retryTimer.current = null;
    if (isEmpty(pending.current)) return chain.current;
    chain.current = chain.current.then(async () => {
      const patch = pending.current;
      if (isEmpty(patch)) return;
      pending.current = {};
      inflight.current = patch;
      setStatus('saving');
      try {
        const { note } = await api.updateNote(noteId, patch);
        inflight.current = {};
        persist();
        attempts.current = 0;
        onSavedRef.current(note);
        setError(null);
        setStatus(isEmpty(pending.current) ? 'saved' : 'pending');
      } catch (err) {
        // Keep the edits (newer ones win) and say so.
        pending.current = { ...patch, ...pending.current };
        inflight.current = {};
        persist();
        setError(describe(err));
        setStatus('error');
        if (isTemporary(err) && mounted.current) {
          const wait = RETRY_DELAYS_MS[Math.min(attempts.current++, RETRY_DELAYS_MS.length - 1)];
          retryTimer.current = setTimeout(() => void flush(), wait);
        }
      }
    });
    return chain.current;
  }, [noteId, persist]);

  const schedule = useCallback(
    (patch: Patch) => {
      Object.assign(pending.current, patch);
      persist();
      setStatus((s) => (s === 'error' ? 'error' : 'pending'));
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), AUTOSAVE_DELAY_MS);
    },
    [flush, persist],
  );

  useEffect(() => {
    mounted.current = true;
    if (!isEmpty(pending.current)) timer.current = setTimeout(() => void flush(), AUTOSAVE_DELAY_MS);
    const onUnload = () => {
      const all = { ...inflight.current, ...pending.current };
      if (isEmpty(all)) return;
      // A last attempt; the copy in this browser stays until a later save is confirmed.
      // Browser fetch keepalive caps bodies at 64 KB; drop keepalive for larger snapshots.
      const body = JSON.stringify(all);
      void fetch(`/api/notes/${encodeURIComponent(noteId)}`, {
        method: 'PATCH',
        keepalive: body.length < 60_000,
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body,
      }).catch(() => {});
    };
    window.addEventListener('beforeunload', onUnload);
    return () => {
      mounted.current = false;
      window.removeEventListener('beforeunload', onUnload);
      void flush(); // closing the note saves what is pending
    };
  }, [noteId, flush]);

  return { schedule, flush, status, error, restored };
}
