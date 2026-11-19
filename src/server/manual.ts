// The "User manual": a read-only note every account has (new accounts get it with the
// starter pack; existing accounts got it once, from the schema version 3 migration).
// Its text uses the starter styles (stamped as plain formatting, as applying a style
// does) and headings; each command is in a code block, exactly as it works.
import { findPalette } from '../shared/palette';
import type { TiptapDoc, TiptapNode } from '../shared/types';
import { docText } from './content';
import type { DB } from './db';
import { newId } from './ids';

export const MANUAL_TITLE = 'User manual';
export const MANUAL_TAG = 'manual';

type Mark = NonNullable<TiptapNode['marks']>[number];
const textStyle = (family: string, size: number, colour: string): Mark => ({
  type: 'textStyle',
  attrs: { fontFamily: `"${family}"`, fontSize: `${size}px`, color: findPalette(colour)!.text },
});
// The starter styles (src/server/starter.ts).
const BODY: Mark[] = [textStyle('Inter', 16, 'Jet')];
const TITLE: Mark[] = [{ type: 'bold' }, textStyle('Playfair Display', 40, 'Jet')];
const QUOTE: Mark[] = [{ type: 'italic' }, textStyle('Lora', 20, 'Violet')];
const ASIDE: Mark[] = [textStyle('Caveat', 24, 'Electric')];

const p = (text: string, marks: Mark[] = BODY): TiptapNode => ({ type: 'paragraph', content: [{ type: 'text', text, marks }] });
const h = (level: 2 | 3, text: string): TiptapNode => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text }] });
const code = (command: string): TiptapNode => ({ type: 'codeBlock', content: [{ type: 'text', text: command }] });
const steps = (...items: string[]): TiptapNode => ({ type: 'orderedList', content: items.map((t) => ({ type: 'listItem', content: [p(t)] })) });

const FILE = 'jot-backup-YYYYMMDD-HHMMSS.tar';

export function manualDoc(): TiptapDoc {
  return {
    type: 'doc',
    content: [
      p('Jot user manual', TITLE),
      p('How to keep your notes safe, and how to get them back. This note is read-only, so it always stays as it is.'),

      h(2, 'Backing up your own data'),
      p('Open Backup in the left bar and choose Back up my data. Jot makes one file, named jot-backup-<your name>-<date>.tar, and your browser downloads it.'),
      p('The file holds all your notes (including the ones in the trash), their tags, your photos, your fonts and your styles. It does not hold your password, or anything of anyone else’s. Keep a copy somewhere safe, such as another disk.'),
      p('Good to know: after a restore every note gets a new address, so links or bookmarks to single notes stop working.', QUOTE),

      h(2, 'Restoring your own data'),
      steps(
        'Open Backup in the left bar. Under Restore from a backup, choose Backup file and pick your backup file.',
        'Read the summary: when the backup was made, and how many notes, photos, fonts and styles it holds.',
        'Type RESTORE in the box and choose Restore.',
      ),
      p('A restore replaces everything you have now with what is in the backup. Before it does, Jot automatically takes a safety backup of your current data. You find it on the Backup screen under Safety backups, where you can download or delete it. Jot never deletes it for you.'),

      h(2, 'Full system backup (for whoever runs the server)'),
      p('A full system backup holds every user’s data plus the accounts. It is done on the server, not in the web app. Run these commands in the folder that holds Jot’s docker-compose.yml, and replace ' + FILE + ' with the file name jot backup printed.'),
      h(3, 'Back up'),
      code('docker compose exec app jot backup'),
      p('The file lands in data/backups, with a .sha256 file beside it. A backup left in data/backups is on the same disk as the data, so copy it to another disk too. To write it to another disk directly, add --out <folder>, where the folder is mounted into the container from that disk.'),
      h(3, 'Check a backup'),
      code(`docker compose exec app jot verify /data/backups/${FILE}`),
      p('Give the path as the container sees it (/data/backups/…). Checking changes nothing.'),
      h(3, 'Restore the whole system'),
      p('Stop the app, move the old data folder aside, make an empty data folder with a backups folder in it, copy the backup in, restore, and start the app:'),
      code('docker compose stop app'),
      code('mv data data-old'),
      code('mkdir -p data/backups'),
      code(`cp data-old/backups/${FILE} data/backups/`),
      code(`docker compose run --rm app jot restore /data/backups/${FILE}`),
      code('docker compose up -d'),
      p('Everyone has to sign in again afterwards. The old data stays untouched in data-old until you delete it.'),

      h(2, 'Read-only notes'),
      p('The lock at the end of the toolbar makes a note read-only: after that nothing about it can be changed and it cannot be deleted. Only whoever runs the server can make it writable again, with this command, where NOTE_ID is the last part of the note’s address (/n/NOTE_ID):'),
      code('docker compose exec app jot unlock-note NOTE_ID'),
      p('This manual is a read-only note too.', ASIDE),
    ],
  };
}

/** Gives a user the manual note (read-only, tagged "manual", in the search index). The caller runs this in a transaction. */
export function addManual(db: DB, userId: string, at: string): string {
  const id = newId();
  const doc = manualDoc();
  db.prepare(
    'INSERT INTO notes (id, user_id, title, content, body_text, created_at, updated_at, deleted_at, read_only) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 1)',
  ).run(id, userId, MANUAL_TITLE, JSON.stringify(doc), docText(doc), at, at);
  db.prepare('INSERT OR IGNORE INTO tags (id, user_id, name) VALUES (?, ?, ?)').run(newId(), userId, MANUAL_TAG);
  const tagId = (db.prepare('SELECT id FROM tags WHERE user_id = ? AND name = ?').get(userId, MANUAL_TAG) as { id: string }).id;
  db.prepare('INSERT INTO note_tags (note_id, tag_id, user_id) VALUES (?, ?, ?)').run(id, tagId, userId);
  db.prepare('INSERT INTO notes_fts (note_id, user_id, title, body, tags) VALUES (?, ?, ?, ?, ?)').run(id, userId, MANUAL_TITLE, docText(doc), MANUAL_TAG);
  return id;
}
