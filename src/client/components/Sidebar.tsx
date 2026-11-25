import { FileText, Inbox, LayoutGrid, NotebookPen, Paintbrush, PanelLeftClose, PanelLeftOpen, Sheet, Tags, Type, UserRound } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useSections } from '../currentSection';
import { useData } from '../data';
import { navigate } from '../router';
import { NewNoteLink } from './NewNoteLink';
import { SectionSquare } from './SectionMarks';

const RAIL_STORAGE_KEY = 'jot.railCollapsed';

function readStoredCollapsed(): boolean {
  try {
    return localStorage.getItem(RAIL_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

interface RailContextValue {
  collapsed: boolean;
  setCollapsed: (next: boolean) => void;
  toggle: () => void;
}

const RailContext = createContext<RailContextValue>({
  collapsed: false,
  setCollapsed: () => {},
  toggle: () => {},
});

export function RailProvider(props: { children: React.ReactNode }) {
  const [collapsed, setCollapsedState] = useState<boolean>(readStoredCollapsed);

  const setCollapsed = useCallback((next: boolean) => {
    setCollapsedState(next);
    try {
      localStorage.setItem(RAIL_STORAGE_KEY, next ? '1' : '0');
    } catch {
      // Ignore storage errors (private browsing / restricted storage).
    }
  }, []);

  const toggle = useCallback(() => {
    setCollapsedState((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(RAIL_STORAGE_KEY, next ? '1' : '0');
      } catch {
        // Ignore storage errors.
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key === '\\') {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggle]);

  return <RailContext.Provider value={{ collapsed, setCollapsed, toggle }}>{props.children}</RailContext.Provider>;
}

export function useRail() {
  return useContext(RailContext);
}

export function RailToggleButton(props: { className?: string; onlyWhenCollapsed?: boolean }) {
  const { collapsed, toggle } = useRail();
  if (props.onlyWhenCollapsed && !collapsed) return null;
  const label = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
  return (
    <button
      type="button"
      className={`rail-toggle-btn ${props.className ?? ''}`}
      aria-label={label}
      aria-expanded={!collapsed}
      title={`${label} (Ctrl+\\)`}
      onClick={toggle}
    >
      {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
    </button>
  );
}

function RailLink(props: { to: string; label: string; active: boolean; children: React.ReactNode; title?: string; className?: string }) {
  return (
    <a
      href={props.to}
      className={`rail-btn ${props.className ?? ''} ${props.active ? 'is-active' : ''}`}
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
  const { current } = useSections();
  const { collapsed } = useRail();
  const [newError, setNewError] = useState<string | null>(null);
  const navRef = useRef<HTMLElement>(null);
  const p = props.path;
  // The count is fetched again on every move between screens (bots write at any time).
  useEffect(() => {
    void reloadInbox();
  }, [p, reloadInbox]);
  useEffect(() => {
    if (navRef.current) navRef.current.inert = collapsed;
  }, [collapsed]);
  return (
    <nav ref={navRef} className={`rail ${collapsed ? 'is-collapsed' : ''}`} aria-label="Main" aria-hidden={collapsed || undefined}>
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
      {/* The section square (sections-spec.md §3): the current section's colour and first letter; it opens the Sections page. */}
      <RailLink to="/sections" label={`Sections (current: ${current.name})`} active={p === '/sections'} className="rail-section">
        <SectionSquare name={current.name} />
      </RailLink>
      <NewNoteLink className="rail-btn" label="New note" bump={bumpNotes} onError={setNewError}>
        <FileText size={20} />
      </NewNoteLink>
      <NewNoteLink className="rail-btn" kind="sheet" label="New spreadsheet" bump={bumpNotes} onError={setNewError}>
        <Sheet size={20} />
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
      <RailLink to="/buttons" label="Buttons" active={p === '/buttons'}>
        <LayoutGrid size={20} />
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
