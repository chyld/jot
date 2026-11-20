// "3 min ago" style relative times for the notes list.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const s = Math.floor((now.getTime() - then.getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return h === 1 ? '1 hour ago' : `${h} hours ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return d === 1 ? '1 day ago' : `${d} days ago`;
  return shortDate(iso);
}

/** "Jan 2, 2026", in the viewer's own time zone (a note made at 5:38 PM on Nov 19 in
 * California is "Nov 19", not the UTC date). Only the web app shows it. */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}
