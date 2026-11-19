import { useEffect, useState } from 'react';
import type { User } from '../shared/types';
import { api, setUnauthorizedHandler } from './api';
import { Sidebar } from './components/Sidebar';
import { DataProvider } from './data';
import { match, navigate, useLocation } from './router';
import { BackupScreen } from './screens/BackupScreen';
import { FontsScreen } from './screens/FontsScreen';
import { Login } from './screens/Login';
import { NotesScreen } from './screens/NotesScreen';
import { NoteScreen } from './screens/NoteScreen';
import { StylesScreen } from './screens/StylesScreen';
import { TrashScreen } from './screens/TrashScreen';

function Screen(props: { path: string; search: URLSearchParams }) {
  const p = props.path;
  if (p === '/') return <NotesScreen tag={props.search.get('tag')} />;
  const note = match('/n/:id', p);
  if (note) return <NoteScreen noteId={note.id} />;
  if (p === '/fonts') return <FontsScreen />;
  if (p === '/styles') return <StylesScreen />;
  if (p === '/backup') return <BackupScreen />;
  if (p === '/trash') return <TrashScreen />;
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

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    api.me().then(
      (r) => setUser(r.user),
      () => setUser(null),
    );
  }, []);

  useEffect(() => {
    if (user === null && path !== '/login') navigate('/login', { replace: true });
    if (user && path === '/login') navigate('/', { replace: true });
  }, [user, path]);

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
