// The five default styles (Body, Title, Quote, Aside, Code) are part of the system: every
// user has exactly one of each, flagged is_default, with its standard definition (the
// starter pack's), and no user can edit, rename or delete them. Styles the user makes are
// ordinary styles, whatever they are called.
import type { DB } from './db';
import { newId } from './ids';
import { STARTER_STYLES } from './starter';

export const DEFAULT_STYLE_NAMES: readonly string[] = STARTER_STYLES.map((s) => s.name);

/**
 * Makes sure the user has exactly the five default styles with their standard
 * definitions, each on the user's font of its family: a flagged one is reset if it
 * differs (its dates change only then), a missing one is created. Ordinary styles are
 * never touched. Runs inside the caller's transaction.
 */
export function ensureDefaultStyles(db: DB, userId: string, at: string) {
  for (const def of STARTER_STYLES) {
    const font = db.prepare('SELECT id FROM fonts WHERE user_id = ? AND family = ?').get(userId, def.font) as { id: string } | undefined;
    if (!font) continue; // starter fonts cannot be deleted; a restore checks the backup has them
    const want = { size: def.size, bold: def.bold ? 1 : 0, italic: def.italic ? 1 : 0, underline: 0, strike: 0, text_color: def.textColor, highlight: null };
    const rows = db
      .prepare('SELECT s.*, f.family FROM styles s LEFT JOIN fonts f ON f.id = s.font_id WHERE s.user_id = ? AND s.is_default = 1 AND s.name = ? ORDER BY s.created_at, s.id')
      .all(userId, def.name) as any[];
    const [row, ...extra] = rows;
    for (const x of extra) db.prepare('DELETE FROM styles WHERE id = ?').run(x.id); // never more than one
    if (!row) {
      db.prepare(
        `INSERT INTO styles (id, user_id, name, font_id, size, bold, italic, underline, strike, text_color, highlight, created_at, updated_at, is_default)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, NULL, ?, ?, 1)`,
      ).run(newId(), userId, def.name, font.id, want.size, want.bold, want.italic, want.text_color, at, at);
      continue;
    }
    const changed =
      row.family !== def.font ||
      row.size !== want.size ||
      row.bold !== want.bold ||
      row.italic !== want.italic ||
      row.underline !== 0 ||
      row.strike !== 0 ||
      row.text_color !== want.text_color ||
      row.highlight !== null;
    db.prepare(
      'UPDATE styles SET font_id = ?, size = ?, bold = ?, italic = ?, underline = 0, strike = 0, text_color = ?, highlight = NULL, updated_at = ? WHERE id = ?',
    ).run(font.id, want.size, want.bold, want.italic, want.text_color, changed ? at : row.updated_at, row.id);
  }
}
