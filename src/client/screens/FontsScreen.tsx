// The Google Fonts catalogue with search, and the user's own fonts with archive.
// Catalogue cards preview each family in its own typeface: the user's own fonts use
// Jot's private copies; other families load a tiny preview (just the letters of the
// name) from Google when the card scrolls into view. Notes never use Google.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, Check, Plus, RotateCcw, Search } from 'lucide-react';
import type { CatalogFont, Font } from '../../shared/types';
import { api } from '../api';
import { useData } from '../data';
import { quoteFamily } from '../editor/stamp';

const PAGE = 60;
const CATEGORIES = ['All', 'Sans Serif', 'Serif', 'Display', 'Handwriting', 'Monospace'];

const loadedPreviews = new Set<string>();
function loadPreview(family: string) {
  if (loadedPreviews.has(family)) return;
  loadedPreviews.add(family);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}&text=${encodeURIComponent(family)}&display=swap`;
  document.head.appendChild(link);
}

function CatalogCard(props: { font: CatalogFont; mine: Font | undefined; busy: boolean; onAdd: () => void; onArchive: () => void }) {
  const ref = useRef<HTMLElement>(null);
  const { font, mine } = props;
  useEffect(() => {
    if (mine) return; // already served by Jot
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      loadPreview(font.family);
      return;
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        loadPreview(font.family);
        io.disconnect();
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, [font.family, mine]);
  const active = mine && !mine.archived;
  return (
    <article ref={ref} className={`card font-card ${active ? 'is-mine' : ''}`} aria-label={font.family} data-testid="catalog-card">
      <div className="font-card-name" style={{ fontFamily: `${quoteFamily(font.family)}, sans-serif` }}>
        {font.family}
      </div>
      <div className="font-card-meta muted small">{font.category}</div>
      {active ? (
        <button type="button" className="btn btn-sm" onClick={props.onArchive} disabled={props.busy}>
          <Archive size={14} /> Archive
        </button>
      ) : (
        <button type="button" className="btn btn-sm" onClick={props.onAdd} disabled={props.busy}>
          {props.busy ? 'Adding…' : mine ? <><RotateCcw size={14} /> Restore</> : <><Plus size={14} /> Add</>}
        </button>
      )}
    </article>
  );
}

export function FontsScreen() {
  const { fonts, reloadFonts } = useData();
  const [catalog, setCatalog] = useState<CatalogFont[] | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [limit, setLimit] = useState(PAGE);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const moreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.catalog().then(
      (r) => setCatalog(r.fonts),
      (e) => setCatalogError(e instanceof Error ? e.message : 'Could not load the catalogue.'),
    );
  }, []);

  const byFamily = useMemo(() => new Map(fonts.map((f) => [f.family, f])), [fonts]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (catalog ?? []).filter((f) => (category === 'All' || f.category === category) && (!q || f.family.toLowerCase().includes(q)));
  }, [catalog, query, category]);
  useEffect(() => setLimit(PAGE), [query, category]);

  // Load more cards when the end of the grid scrolls into view.
  useEffect(() => {
    const el = moreRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && setLimit((l) => l + PAGE));
    io.observe(el);
    return () => io.disconnect();
  }, [filtered.length, limit]);

  const run = async (family: string, fn: () => Promise<unknown>) => {
    setBusy(family);
    setError(null);
    try {
      await fn();
      await reloadFonts();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  };
  const add = (family: string) => run(family, () => api.addFont(family));
  const archive = (f: Font) => run(f.family, () => api.archiveFont(f.id));
  const unarchive = (f: Font) => run(f.family, () => api.unarchiveFont(f.id));

  const active = fonts.filter((f) => !f.archived);
  const archived = fonts.filter((f) => f.archived);

  return (
    <div className="screen">
      <div className="screen-head">
        <h1>Fonts</h1>
      </div>
      <section aria-label="Your fonts" className="my-fonts">
        <div className="muted small">Your fonts ({active.length})</div>
        <ul className="chips">
          {active.map((f) => (
            <li key={f.id} className="chip font-chip" style={{ fontFamily: `${quoteFamily(f.family)}, sans-serif` }}>
              {f.family}
              <button type="button" className="chip-x" aria-label={`Archive ${f.family}`} title="Archive" onClick={() => void archive(f)} disabled={busy === f.family}>
                <Archive size={12} />
              </button>
            </li>
          ))}
        </ul>
        {archived.length > 0 && (
          <>
            <div className="muted small">Archived ({archived.length}) — hidden from pickers; notes and styles that use them still work.</div>
            <ul className="chips" aria-label="Archived fonts">
              {archived.map((f) => (
                <li key={f.id} className="chip font-chip is-archived" style={{ fontFamily: `${quoteFamily(f.family)}, sans-serif` }}>
                  {f.family}
                  <button type="button" className="chip-x" aria-label={`Restore ${f.family}`} title="Restore" onClick={() => void unarchive(f)} disabled={busy === f.family}>
                    <RotateCcw size={12} />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <div className="catalog-bar">
        <label className="search-box grow">
          <Search size={16} />
          <input type="search" placeholder="Search fonts" aria-label="Search fonts" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
          {CATEGORIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <span className="muted small" data-testid="catalog-count">
          {catalog ? `${filtered.length} of ${catalog.length}` : ''}
        </span>
      </div>
      {error && (
        <div role="alert" className="banner banner-error">
          {error}
        </div>
      )}
      {catalogError && (
        <div role="alert" className="banner banner-error">
          {catalogError}
        </div>
      )}
      {!catalog && !catalogError && <p className="muted">Loading the Google Fonts catalogue…</p>}
      <div className="card-grid fonts-grid">
        {filtered.slice(0, limit).map((f) => {
          const mine = byFamily.get(f.family);
          return (
            <CatalogCard
              key={f.family}
              font={f}
              mine={mine}
              busy={busy === f.family}
              onAdd={() => void add(f.family)}
              onArchive={() => mine && void archive(mine)}
            />
          );
        })}
      </div>
      {filtered.length > limit && (
        <div ref={moreRef} className="load-more">
          <button type="button" className="btn" onClick={() => setLimit((l) => l + PAGE)}>
            Show more
          </button>
        </div>
      )}
      {catalog && filtered.length === 0 && (
        <p className="muted">
          <Check size={14} /> No fonts match “{query}”.
        </p>
      )}
    </div>
  );
}
