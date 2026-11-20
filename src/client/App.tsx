import { useEffect, useRef, useState } from 'react';
import type { User } from '../shared/types';
import { api, setUnauthorizedHandler } from './api';
import { Sidebar } from './components/Sidebar';
import { DataProvider, useData } from './data';
import { createAndOpenNote } from './newNotes';
import { match, navigate, useLocation } from './router';
import { AccountScreen } from './screens/AccountScreen';
import { FontsScreen } from './screens/FontsScreen';
import { InboxScreen } from './screens/InboxScreen';
import { Login } from './screens/Login';
import { NotesScreen } from './screens/NotesScreen';
import { NoteScreen } from './screens/NoteScreen';
import { StylesScreen } from './screens/StylesScreen';
import { TagsScreen } from './screens/TagsScreen';
import { TrashScreen } from './screens/TrashScreen';

/**
 * /new (bookmarkable): creates a new note once and opens it, replacing /new in the history
 * with the note's address, so Back and Refresh never return here or make a second note.
 * The ref keeps React StrictMode's second effect from creating another.
 */
function NewNoteScreen() {
  const { bumpNotes } = useData();
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const create = () => {
    setError(null);
    void createAndOpenNote(bumpNotes, { replace: true }).then(setError);
  };
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    create();
  }, []);
  if (!error) return <div className="loading">Creating note…</div>;
  return (
    <div className="screen">
      <div role="alert" className="form-error">
        {error}
      </div>
      <button type="button" className="btn btn-primary" onClick={create}>
        Try again
      </button>
    </div>
  );
}

/** After logging in, go back to the address that sent you to /login. Only /new is kept. */
const RETURN_PATHS = ['/new'];

function Screen(props: { path: string; search: URLSearchParams }) {
  const p = props.path;
  if (p === '/') return <NotesScreen tag={props.search.get('tag')} />;
  const note = match('/n/:id', p);
  if (note) return <NoteScreen noteId={note.id} />;
  if (p === '/new') return <NewNoteScreen />;
  if (p === '/fonts') return <FontsScreen />;
  if (p === '/styles') return <StylesScreen />;
  if (p === '/account') return <AccountScreen />;
  if (p === '/inbox') return <InboxScreen />;
  if (p === '/trash') return <TrashScreen />;
  if (p === '/tags') return <TagsScreen />;
  return (
    <div className="screen">
      <h1>Not found</h1>
      <p>There is nothing here.</p>
    </div>
  );
}

export function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const { path, search } = useLocation();
  const next = search.get('next');

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    api.me().then(
      (r) => setUser(r.user),
      () => setUser(null),
    );
  }, []);

  useEffect(() => {
    if (user === null && path !== '/login') {
      navigate(RETURN_PATHS.includes(path) ? `/login?next=${encodeURIComponent(path)}` : '/login', { replace: true });
    }
    if (user && path === '/login') {
      navigate(next && RETURN_PATHS.includes(next) ? next : '/', { replace: true });
    }
  }, [user, path, next]);

  if (user === undefined) return <div className="loading">Loading…</div>;
  if (user === null) return <Login onLogin={setUser} />;
  return (
    <DataProvider key={user.id} user={user} onLogout={() => setUser(null)}>
      <div className="app">
        <Sidebar path={path} />
        <main className="main">
          <Screen path={path} search={search} />
        </main>
      </div>
    </DataProvider>
  );
}
