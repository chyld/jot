import { LogOut, NotebookPen, Paintbrush, Plus, Trash2, Type, UserRound } from 'lucide-react';
import { api } from '../api';
import { useData } from '../data';
import { markNewNote } from '../newNotes';
import { navigate } from '../router';

function RailLink(props: { to: string; label: string; active: boolean; children: React.ReactNode }) {
  return (
    <a
      href={props.to}
      className={`rail-btn ${props.active ? 'is-active' : ''}`}
      aria-label={props.label}
      title={props.label}
      aria-current={props.active ? 'page' : undefined}
      onClick={(e) => {
        e.preventDefault();
        navigate(props.to);
      }}
    >
      {props.children}
    </a>
  );
}

export async function createAndOpenNote(bump: () => void) {
  const { note } = await api.createNote();
  markNewNote(note.id); // its editor opens with the caret in the body
  bump();
  navigate(`/n/${note.id}`);
}

export function Sidebar(props: { path: string }) {
  const { bumpNotes, logout, user } = useData();
  const p = props.path;
  return (
    <nav className="rail" aria-label="Main">
      <a
        href="/"
        className={`rail-logo ${p === '/' ? 'is-home' : ''}`}
        aria-label="Jot home: all notes"
        title="All notes"
        aria-current={p === '/' ? 'page' : undefined}
        onClick={(e) => {
          e.preventDefault();
          navigate('/');
        }}
      >
        <NotebookPen size={26} />
      </a>
      <button type="button" className="rail-new" aria-label="New note" title="New note" onClick={() => void createAndOpenNote(bumpNotes)}>
        <Plus size={24} />
      </button>
      <div className="rail-spacer" />
      <RailLink to="/fonts" label="Fonts" active={p === '/fonts'}>
        <Type size={22} />
      </RailLink>
      <RailLink to="/styles" label="Styles" active={p === '/styles'}>
        <Paintbrush size={22} />
      </RailLink>
      <RailLink to="/account" label="Account" active={p === '/account'}>
        <UserRound size={22} />
      </RailLink>
      <RailLink to="/trash" label="Trash" active={p === '/trash'}>
        <Trash2 size={22} />
      </RailLink>
      <button type="button" className="rail-btn" aria-label={`Log out ${user.username}`} title={`Log out (${user.username})`} onClick={() => void logout()}>
        <LogOut size={22} />
      </button>
    </nav>
  );
}
