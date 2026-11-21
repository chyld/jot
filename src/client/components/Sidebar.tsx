import { Inbox, NotebookPen, Paintbrush, Plus, Tags, Trash2, Type, UserRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { useData } from '../data';
import { navigate } from '../router';
import { NewNoteLink } from './NewNoteLink';
import { SectionMenu } from './SectionMenu';

function RailLink(props: { to: string; label: string; active: boolean; children: React.ReactNode; title?: string }) {
  return (
    <a
      href={props.to}
      className={`rail-btn ${props.active ? 'is-active' : ''}`}
      aria-label={props.label}
      title={props.title ?? props.label}
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

export { createAndOpenNote } from '../newNotes';

export function Sidebar(props: { path: string }) {
  const { bumpNotes, inboxCount, reloadInbox } = useData();
  const [newError, setNewError] = useState<string | null>(null);
  const p = props.path;
  // The count is fetched again on every move between screens (bots write at any time).
  useEffect(() => {
    void reloadInbox();
  }, [p, reloadInbox]);
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
        <NotebookPen size={20} />
      </a>
      <SectionMenu />
      <NewNoteLink className="rail-new" label="New note" bump={bumpNotes} onError={setNewError}>
        <Plus size={20} />
      </NewNoteLink>
      <RailLink to="/inbox" label="Inbox" title={`Inbox: ${inboxCount} ${inboxCount === 1 ? 'note' : 'notes'} from bots`} active={p === '/inbox'}>
        <span className="rail-inbox">
          <Inbox size={20} />
          <span className="rail-count" data-testid="inbox-count">
            {inboxCount > 0 ? inboxCount : ''}
          </span>
        </span>
      </RailLink>
      <RailLink to="/tags" label="Tags" active={p === '/tags'}>
        <Tags size={20} />
      </RailLink>
      <div className="rail-spacer" />
      <RailLink to="/fonts" label="Fonts" active={p === '/fonts'}>
        <Type size={20} />
      </RailLink>
      <RailLink to="/styles" label="Styles" active={p === '/styles'}>
        <Paintbrush size={20} />
      </RailLink>
      <RailLink to="/trash" label="Trash" active={p === '/trash'}>
        <Trash2 size={20} />
      </RailLink>
      <RailLink to="/account" label="Account" active={p === '/account'}>
        <UserRound size={20} />
      </RailLink>
      {newError && (
        <div role="alert" className="rail-error" onClick={() => setNewError(null)}>
          {newError}
        </div>
      )}
    </nav>
  );
}
