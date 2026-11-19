// Type 3 (unit): the User manual note is a valid Jot document (it survives the
// sanitiser unchanged), uses the starter styles and headings, and every command in it
// is exactly one that works.
import { describe, expect, it } from 'vitest';
import { sanitizeDoc } from '../../src/server/content';
import { MANUAL_TITLE, MANUAL_TAG, manualDoc } from '../../src/server/manual';

const codeBlocks = (d: any): string[] => {
  const out: string[] = [];
  const walk = (n: any) => {
    if (n.type === 'codeBlock') out.push((n.content ?? []).map((t: any) => t.text).join(''));
    (n.content ?? []).forEach(walk);
  };
  walk(d);
  return out;
};
const textOf = (d: any): string => JSON.stringify(d);

describe('User manual', () => {
  it('is titled and tagged as specified', () => {
    expect(MANUAL_TITLE).toBe('User manual');
    expect(MANUAL_TAG).toBe('manual');
  });

  it('passes the sanitiser unchanged', () => {
    const d = manualDoc();
    expect(JSON.stringify(sanitizeDoc(d))).toBe(JSON.stringify(d));
  });

  it('has the four sections as headings', () => {
    const headings = (manualDoc().content ?? []).filter((n: any) => n.type === 'heading').map((n: any) => n.content.map((t: any) => t.text).join(''));
    expect(headings).toEqual(
      expect.arrayContaining([
        'Backing up your own data',
        'Restoring your own data',
        'Full system backup (for whoever runs the server)',
        'Read-only notes',
      ]),
    );
  });

  it('uses the starter styles (their fonts, sizes and colours) for its text', () => {
    const looks = new Set<string>();
    const walk = (n: any) => {
      for (const m of n.marks ?? []) if (m.type === 'textStyle') looks.add(`${m.attrs.fontFamily} ${m.attrs.fontSize} ${m.attrs.color}`);
      (n.content ?? []).forEach(walk);
    };
    walk(manualDoc());
    expect([...looks].sort()).toEqual(
      [
        '"Inter" 16px #141414', // Body
        '"Playfair Display" 40px #141414', // Title
        '"Lora" 20px #8F2AF4', // Quote
        '"Caveat" 24px #0A47FF', // Aside
      ].sort(),
    );
  });

  it('shows each command in its own code block, exactly as it works', () => {
    expect(codeBlocks(manualDoc())).toEqual([
      'docker compose exec app jot backup',
      'docker compose exec app jot verify /data/backups/jot-backup-YYYYMMDD-HHMMSS.tar',
      'docker compose stop app',
      'mv data data-old',
      'mkdir -p data/backups',
      'cp data-old/backups/jot-backup-YYYYMMDD-HHMMSS.tar data/backups/',
      'docker compose run --rm app jot restore /data/backups/jot-backup-YYYYMMDD-HHMMSS.tar',
      'docker compose up -d',
      'docker compose exec app jot unlock-note NOTE_ID',
    ]);
    const s = textOf(manualDoc());
    for (const words of ['RESTORE', 'Safety backups', 'data/backups', 'same disk', '--out', 'sign in again', 'data-old', '/n/NOTE_ID']) {
      expect(s).toContain(words);
    }
  });
});
