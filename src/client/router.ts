// A very small history-API router.
import { useEffect, useState } from 'react';

const listeners = new Set<() => void>();

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  if (to === location.pathname + location.search) return;
  if (opts.replace) history.replaceState(null, '', to);
  else history.pushState(null, '', to);
  listeners.forEach((l) => l());
}

/** The current path and query string; re-renders on every navigation. */
export function useLocation(): { path: string; search: URLSearchParams } {
  const [href, setHref] = useState(() => location.pathname + location.search);
  useEffect(() => {
    const update = () => setHref(location.pathname + location.search);
    listeners.add(update);
    window.addEventListener('popstate', update);
    return () => {
      listeners.delete(update);
      window.removeEventListener('popstate', update);
    };
  }, []);
  const q = href.indexOf('?');
  return { path: q < 0 ? href : href.slice(0, q), search: new URLSearchParams(q < 0 ? '' : href.slice(q)) };
}

export function usePath(): string {
  return useLocation().path;
}

/** The home page, optionally with the tag filter set to `tag`. */
export function homeHref(tag?: string | null): string {
  return tag ? `/?tag=${encodeURIComponent(tag)}` : '/';
}

/** Matches "/n/:id" style patterns; returns the params or null. */
export function match(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split('/');
  const a = path.split('/');
  if (p.length !== a.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(':')) {
      if (!a[i]) return null;
      try {
        params[p[i].slice(1)] = decodeURIComponent(a[i]);
      } catch {
        return null;
      }
    } else if (p[i] !== a[i]) return null;
  }
  return params;
}
