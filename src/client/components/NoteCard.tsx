import { useEffect, useState } from 'react';
import { Bot, Lock } from 'lucide-react';
import { relativeTime } from '../../shared/time';
import type { NoteSummary } from '../../shared/types';
import { homeHref, navigate } from '../router';

/** Re-renders every 30 s so "3 min ago" stays current. */
export function useNow(intervalMs = 30000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

const go = (href: string) => (e: React.MouseEvent) => {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; // let the browser open new tabs
  e.preventDefault();
  navigate(href);
};

/**
 * A note in a list. The whole card opens the note (its title link is stretched over
 * the card); each tag name is its own link to the home page filtered by that tag.
 */
export function NoteCard(props: { note: NoteSummary; selected?: boolean; now: Date; href?: string }) {
  const n = props.note;
  const href = props.href ?? `/n/${n.id}`;
  return (
    <article className={`note-card ${props.selected ? 'is-selected' : ''}`} data-note-id={n.id} aria-label={n.title || 'Untitled'}>
      <div className="note-card-top">
        <a href={href} className="note-card-title note-card-link" aria-current={props.selected ? 'true' : undefined} onClick={go(href)}>
          {n.title || 'Untitled'}
        </a>
        {n.readOnly && (
          <span className="note-card-lock" role="img" aria-label="Read-only" title="Read-only">
            <Lock size={13} />
          </span>
        )}
        {n.botName && (
          <span className="bot-chip" data-testid="note-bot" title={`Written by the bot ${n.botName}`}>
            <Bot size={12} /> {n.botName}
          </span>
        )}
        <span className="note-card-time">{relativeTime(n.updatedAt, props.now)}</span>
      </div>
      {n.preview && <div className="note-card-preview">{n.preview}</div>}
      {n.tags.length > 0 && (
        <div className="note-card-tags">
          {n.tags.map((t) => (
            <a key={t} href={homeHref(t)} className="tag-chip-sm" title={`Notes tagged ${t}`} onClick={go(homeHref(t))}>
              #{t}
            </a>
          ))}
        </div>
      )}
    </article>
  );
}
