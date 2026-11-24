// Style buttons: ten fixed slots (1–10) per user, stored sparsely in style_buttons
// (a missing row means unbound and shown). Every query filters by user_id.
import { STYLE_BUTTON_SLOTS, type ButtonSlot, type StyleButton, type StyleButtonPatch } from '../shared/buttons';
import type { DB } from './db';

export class ButtonError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

/** All ten buttons for the user, always in slot order 1–10. */
export function listButtons(db: DB, userId: string): StyleButton[] {
  const rows = new Map(
    (
      db.prepare('SELECT slot, style_id, hidden FROM style_buttons WHERE user_id = ?').all(userId) as Array<{
        slot: number;
        style_id: string | null;
        hidden: number;
      }>
    ).map((r) => [r.slot, r]),
  );
  return STYLE_BUTTON_SLOTS.map((slot) => {
    const r = rows.get(slot);
    return { slot, styleId: r?.style_id ?? null, hidden: r?.hidden === 1 };
  });
}

/** Updates one slot's bound style and/or hidden flag. */
export function updateButton(db: DB, userId: string, slot: ButtonSlot, patch: StyleButtonPatch): StyleButton {
  return db.transaction((): StyleButton => {
    if (patch.styleId !== undefined && patch.styleId !== null) {
      const owned = db.prepare('SELECT 1 FROM styles WHERE id = ? AND user_id = ?').get(patch.styleId, userId);
      if (!owned) throw new ButtonError('Choose one of your styles.', 400);
    }
    const cur = db.prepare('SELECT style_id, hidden FROM style_buttons WHERE user_id = ? AND slot = ?').get(userId, slot) as
      | { style_id: string | null; hidden: number }
      | undefined;
    const styleId = patch.styleId !== undefined ? patch.styleId : (cur?.style_id ?? null);
    const hidden = patch.hidden !== undefined ? patch.hidden : cur?.hidden === 1;
    if (styleId === null && !hidden) {
      db.prepare('DELETE FROM style_buttons WHERE user_id = ? AND slot = ?').run(userId, slot);
    } else {
      db.prepare(
        `INSERT INTO style_buttons (user_id, slot, style_id, hidden) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, slot) DO UPDATE SET style_id = excluded.style_id, hidden = excluded.hidden`,
      ).run(userId, slot, styleId, hidden ? 1 : 0);
    }
    return { slot, styleId, hidden };
  })();
}
