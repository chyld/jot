# Jot — decisions

Choices made where `jot-spec.md` is silent, plus what was verified at the start of the
build. Each one is the simplest behaviour I could find that is consistent with the spec.
The spec itself is unchanged.

## Verified at the start of the build (spec §13 "To verify")

Checked against Tiptap's current documentation (tiptap.dev, November 2026) and the
published package source. All Tiptap packages are pinned to **3.34.0**.

| Need | Extension used | Notes |
|---|---|---|
| Font size | `FontSize` from `@tiptap/extension-text-style` 3.34.0 | Commands `setFontSize('24px')` / `unsetFontSize()`. Requires the `TextStyle` mark, which is registered too. Stored as a `fontSize` attribute on `textStyle`. |
| Table column resize | `Table` from `@tiptap/extension-table` 3.34.0 with `resizable: true` | This wires in prosemirror-tables' `columnResizing`; widths are stored as `colwidth` on cells. `TableRow`, `TableHeader`, `TableCell` come from the same package. |
| Font family, text colour | `FontFamily`, `Color` from `@tiptap/extension-text-style` | |
| Highlight colour | `@tiptap/extension-highlight` with `multicolor: true` | Renders `<mark data-color style="background-color">`. |
| Task list | `TaskList`, `TaskItem` from `@tiptap/extension-list` | |
| Underline, link, undo/redo | Included in `@tiptap/starter-kit` 3.x | |
| Photo | `@tiptap/extension-image` 3.34.0, extended | See "Photos" below for why Jot uses its own node view. |

## Look and toolbar

- The reference screenshots show one extra toolbar dropdown (`≡ ▾`, between the list and
  insert menus) that the spec does not list. The toolbar follows the spec's nine items.
- The spec's Insert menu includes **Block quote**, which the screenshots do not show; it
  is included.
- Folders, the inbox and the "BETA" panel toggle from the screenshots are left out (spec).
- The Styles button shows the name of a style when the text at the caret matches that
  style exactly (as in the screenshot where it reads "Eyebro…"); otherwise "Styles".
- Destructive actions (delete style, delete permanently) confirm with a second click on
  the same card rather than a browser dialog.
- The UI font is Inter (every user has it from the starter pack).
- The left bar (owner feedback) holds the Jot logo, which is the link home and is
  highlighted on the home page, and the New note button; at the bottom: Fonts, Styles,
  Trash and Log out. There is no notes icon. (A Tags item was added later; see "Tags page,
  card trash button and a slimmer left bar".)
- **Log out moved to the Account page (owner request).** The left bar no longer has a
  log out button; its bottom group is Fonts, Styles, Trash, then Account last. Log out is
  a button in the Account page's heading row, with the same accessible name as before
  ("Log out <username>").

## Accounts, sessions and the CLI

- Usernames: 1–32 characters, lowercase letters, digits or underscore. Login is
  case-insensitive (usernames are stored in lowercase).
- Passwords: at least 8 characters (at most 1024).
- CLI commands: `jot create-user <name>`, `jot set-password <name>`, `jot list-users`,
  run as `docker compose exec app jot …`. The password is asked twice with hidden input
  on a terminal, or read from the first line of standard input when piped.
- Sessions last 30 days from login. The cookie is `HttpOnly`, `SameSite=Lax`, `Path=/`.
  It is not `Secure` by default because Jot serves plain HTTP on port 9003; set
  `JOT_SECURE_COOKIES=1` if you put Jot behind HTTPS. Only a SHA-256 of the session
  token is stored.
- A failed login says "Wrong username or password." for both an unknown user and a wrong
  password, and takes the same time for both (a dummy Argon2 check).
- Cross-site protection: state-changing requests with a foreign `Origin` are refused, and
  the API only accepts JSON (and multipart for photos), so HTML forms cannot post to it.
- No login rate limiting (fewer than 10 users, and Argon2id makes guessing slow).

## Notes, tags, trash, search

- **Read-only notes (owner request).**
  - Storage: a `read_only` column on notes (schema version 3).
  - Turning it on is one route, `POST /api/notes/:id/read-only`. It is one-way: the web app
    has no route that turns it off; only `jot unlock-note <note id>` does.
  - It does not change the note's dates, and asking again changes nothing. A note in the
    trash can't be made read-only (409), so a read-only note is never in the trash, and
    Empty trash and permanent delete never meet one.
  - Every route that changes a note checks it on the server (title and body saves, add
    tag, remove tag, move to trash) and refuses with 403: "This note is read-only: it
    cannot be changed or deleted. It can only be made writable again from the command
    line on the server." 403 is not a temporary refusal, so autosave does not retry it.
  - Editor: the lock is the last control in the toolbar. Its in-page confirmation (Confirm /
    Cancel) is the same second-click pattern as the other irreversible actions. Pending
    edits are saved before the note is locked.
  - A read-only note shows a "Read-only" badge in the note header. The editor and title
    are not editable, and the tag box, remove buttons and trash button are hidden.
  - Every toolbar control is disabled through one shared "toolbar disabled" setting; the
    table and photo bars are hidden. ProseMirror still lets text be selected and copied.
    Any unsaved edits this browser kept for the note are dropped, since they could never
    be saved.
  - Note cards show a small lock (labelled "Read-only").
- **`jot unlock-note <note id>`** takes the system-wide lock like every CLI command, works
  next to the running app (SQLite), and does not change the note's dates.
  - It prints `Note "<title>" (owner <username>) is writable again.`
  - An unknown or malformed id gets "No note with id …". A note that isn't read-only
    gets "… is not read-only; nothing was changed." Both exit 1.
- **User manual.** `src/server/manual.ts` builds the document.
  - It uses the starter styles stamped as plain formatting, as applying a style does:
    Title for its first line, Body for text, Quote for a tip, Aside for the last line.
    It also uses headings, a numbered list, and one code block per command.
  - The commands are the ones the CLI and the smoke test run, with the file and note
    placeholders written as `jot-backup-YYYYMMDD-HHMMSS.tar` and `NOTE_ID`.
  - New accounts get it inside the same transaction as the starter pack.
  - Existing accounts get it from the schema version 3 migration. That is one transaction
    which adds the column and one manual per user, so it runs exactly once.
  - It reuses a `manual` tag the user may already have. The migration is tested against
    a copy of a database made by the previous version (`tests/fixtures/jot-v2.db`).
  - Most tests remove the manual from their test users so they can count notes simply.
    The manual's own tests keep it.
- **The Backup page** went back to three cards (owner request). The full system backup
  instructions now live in the User manual note instead.
- **Account page (owner request).** The Backup screen became the Account page at
  `/account`.
  - It shows the username at the top, then the same three parts, working as before.
  - `/backup` shows Not found, like other removed routes.
  - The left-bar item in the same place is now "Account" with a person icon.
  - There are no account settings: user administration stays on the command line.
  - The words "Backup screen" and "Open Backup in the left bar" changed everywhere: the
    UI, the CLI and restore messages for a personal backup, the docs and the User manual.
  - Schema version 5 replaces the text of every existing User manual note.
    - The manual is the read-only note titled "User manual" tagged `manual`. A writable
      note with that title, or a read-only note with another title, is not touched.
    - Only its content, plain text and search-index text change: same note, id, tags,
      dates and read-only flag.
    - Tested against a copy of a version-4 database (`tests/fixtures/jot-v4.db`).
  - A personal backup made earlier still holds the manual text it had. Restoring it
    brings that text back, as a restore brings back what the backup holds.
- **Tab in the Add tag box (owner request).** With text in the box, Tab does exactly what
  Enter does: the same check and lowercase conversion, the same message. Its default is
  prevented, so the cursor stays in the box for the next tag; an invalid tag keeps its
  text and shows the message. Tab on an empty box, and Shift+Tab always, keep the
  browser's normal focus move, so no one is trapped.
  - Typing several tags quickly exposed a race, for Enter as well. The box used to stay
    filled (and busy) until the server answered, so a second tag typed in the meantime
    was appended to the first and its key was ignored.
  - Now the box is cleared as soon as a tag passes the check, and the adds go to the
    server one at a time, in order.
  - If the server refuses one, its message shows and its text comes back into the box,
    if the box is still empty.

- **Empty trash (owner request)** is one route, `DELETE /api/trash`, answering
  `{ deleted: n }`.
  - In one transaction it permanently deletes every note of the logged-in user that is in
    the trash, removes their search-index rows (trashed notes have none, but this keeps it
    exact), and deletes tags no note uses any more. That is the same as permanent delete,
    note by note.
  - Photo files stay on disk, as with permanent delete.
  - The Trash screen shows the button only when the trash has notes. The first click
    shows, in the page, "N notes will be deleted forever. This cannot be undone." with
    "Confirm: empty trash" and Cancel, the same second-click pattern as "Delete
    permanently".
  - While a restore of the user's data is running, it is refused like every other change.

- Home page (owner feedback): the list, search, New and the tag filter. The tag filter
  shows one chip per tag that is on at least one live note, plus "All". Choosing a chip
  again also clears it. Search and the tag filter combine: search results are narrowed
  to the chosen tag.
- There was no separate Tags page for a while (owner feedback). The owner later asked for
  one back, for counts and deleting tags: see "Tags page, card trash button and a slimmer
  left bar". The home page filter is still how notes are browsed by tag. It lives in the URL
  as `/?tag=name`, so clicking a tag's name in a note's header or on a note card opens
  the home page with that filter selected, and Back returns to where you were. A
  `?tag=` naming a tag that no live note of yours has clears the filter.
  `GET /api/tags` stays; the filter uses it.
- On a note card the tag names are links of their own; clicking anywhere else on the
  card opens the note.
- Opening a note shows it full screen; moving a note to the trash returns to the home page.
- An empty title shows as "Untitled". Titles are at most 500 characters.
- The list preview is the first 140 characters of the note's text. The list is ordered
  by last update, newest first. Notes save automatically 0.6 s after typing stops.
- A trashed note can still be opened (read-only, with a Restore button) but cannot be
  edited or tagged. "Delete permanently" only works on a note that is in the trash.
- Tags are added with Enter (or a comma) in the "Add tag" box and removed with the ×
  on each chip. The box reads what is actually in the field when Enter is pressed
  (see "Tag input fix" below).
- Tags: surrounding spaces are trimmed; a leading `#` is rejected like any other
  non-letter. Tags are shown sorted. The home page filter shows a tag while at least
  one non-trashed note uses it; a tag row is deleted when no note (trashed or not) uses it.
- Search: each word is matched as a prefix, all words must match (AND), and `#word`
  matches that tag exactly. At most 20 terms are used. Results are ranked by relevance.

## Tags page, card trash button and a slimmer left bar (owner request)

- **Left bar.** 48 px wide (was 64), with 36 px buttons (were 44) and 20 px icons. It gained
  a Tags item after the Inbox.
- **Trash button on note cards.** Only in the home page's notes list (not the Inbox). One
  click moves the note to the trash through the existing `DELETE /api/notes/:id`. There is
  no confirmation, because the trash is recoverable; instead a line above the list says
  which note moved, with Undo (restore) and Dismiss. Only the last trashed note can be
  undone from there; the rest are on the Trash page.
  - A read-only note's card has no trash button (the server refuses it anyway, 403).
  - The button sits above the card's stretched title link, so clicking it never opens the
    note. Its accessible name is "Move <title> to the trash".
- **Tags page (`/tags`).** Lists what `GET /api/tags` returns: the user's tags with the
  number of live notes outside the Inbox, by name. A tag's name opens the home page
  filtered by it.
- **Deleting a tag** is `DELETE /api/tags/:tag`, answering `{ tag, removedFrom }`.
  - It removes the tag from every note of the user that has it, in one transaction, and
    keeps the notes. That includes notes in the Inbox and in the trash, so restoring a
    note cannot bring a deleted tag back. `removedFrom` counts all of them, so it can be
    higher than the count the page showed.
  - Refused with 409 while a read-only note has the tag, and nothing changes: a read-only
    note cannot change through the web app. So the "manual" tag of the User manual cannot
    be deleted (the manual is found by that tag).
  - 404 for a tag the user does not have (also another user's tag, and a name that cannot
    be a tag). Notes' dates do not change, as with removing a tag from one note.
  - The page asks once more in the tag's own row (Confirm: delete tag / Cancel), saying the
    notes are kept: the same second-click pattern as the other destructive actions.
- The User manual note was not changed.
- Covered by `tests/api/tags-delete.test.ts`, `tests/component/tags-trash-card.test.tsx`
  and `e2e/specs/tags-page.spec.ts`.

## Note status line and local dates (owner request)

- **Status line.** A `<footer aria-label="Note status">` under the note page, so the header
  wraps less. The save status, dates, Read-only and "From <bot>" labels moved there from the
  header (same test ids and `role="status"`); the title, tags, Keep and trash stay in the header.
  - Word and character counts come from the editor's text, not its HTML: words are runs of
    non-space characters (paragraphs are separated, so words do not join across them);
    characters are the text's code points, spaces included, with nothing counted between
    paragraphs. Photos count as nothing. They update on every change to the body.
  - Order: counts, save status, labels; dates at the right. The counts come first so a save
    starting never moves them. While idle the save status is empty and takes no room; once
    it says something it keeps room for "Unsaved changes", so the labels after it stay put.
  - The bar is `user-select: none`. Otherwise Chrome's triple click on the body's last
    paragraph of a read-only note extended the selection to the start of the next block (the
    bar), and only a line break ended up selected.
  - One row at any width: nothing wraps; "Created …" truncates, then is hidden below a
    560 px wide bar (a container query), and the updated time stays.
  - Hidden in print, like the wrap marker.
- **Dates in the viewer's time zone.** `shortDate` used the UTC date, so a note made at
  5:38 PM on Nov 19 in California said "Created Nov 20". It now uses the browser's local
  date. Only the web app uses it (the note's dates, and `relativeTime` for times over 30
  days in the notes list, Trash and the Account page); the server, MCP output and backups
  do not, and keep their ISO timestamps unchanged.
- Covered by `tests/unit/fonts-time.test.ts` (TZ pinned to America/Los_Angeles),
  `tests/component/note-status.test.tsx` (the real NoteEditor) and `e2e/specs/note-status.spec.ts`.

## Editor and styles

- **Clear formatting** is one Tiptap chain, so one transaction and one undo step.
  - With nothing selected it leaves existing text and blocks alone and only empties the
    "next typed" marks (`tr.setStoredMarks([])`), so what is typed next is plain.
    (Originally it selected and cleared the whole current paragraph; changed at the
    owner's request, see the entry near the end.)
  - With text selected, Tiptap's `clearNodes` turns headings, list items, task items,
    quotes and code blocks into paragraphs (it cannot lift anything out of a table cell,
    so tables stay; photos are untouched), and it unsets textStyle (font, size, colour),
    highlight, bold, italic, underline, strikethrough and inline code, but not links, and
    empties the "next typed" marks.
  - It is disabled on read-only notes with the rest of the toolbar.
- **Links**
  - A small extension handles clicks on links inside the editor: Ctrl or Cmd, or a
    read-only note, means `window.open(href, '_blank', 'noopener,noreferrer')`.
  - The browser's own navigation is always prevented, so a plain click in an editable
    note only places the cursor.
  - Every Ctrl/Cmd+mousedown inside a note is taken by the extension (owner bug report,
    first for links, then for all text).
    - ProseMirror treats a modifier click as "select the enclosing node". It used to
      node-select the whole paragraph, list item, cell, heading or quote, and the next
      keystroke replaced it.
    - Taking the mousedown (and preventing its default) means ProseMirror never sees it,
      so the selection stays exactly as it was and the editor's focus is unchanged.
    - So Ctrl/Cmd+click on ordinary text also leaves the selection unchanged; it no longer
      selects the paragraph.
    - Ctrl/Cmd+click on a photo no longer selects it (a plain click still does, with its
      controls and handles).
    - Keyboard shortcuts (Ctrl/Cmd+A, C, V, …) are untouched: this is only about mouse
      buttons.
  - Only http(s) and mailto open (the server's sanitiser keeps no others).
  - The "Ctrl+click to open" hint is the link's tooltip, drawn when the link is shown
    and not stored with it. It uses Tiptap's Link, now a declared dependency
    (`@tiptap/extension-link` 3.34.0, the version StarterKit already used), extended only
    to add that tooltip.
  - Typed web addresses become links through Tiptap's autolink on typing. Pasting stays
    plain, since paste rules and link-on-paste are off.
- **Writing area**
  - The writing area has no maximum width, so it spans the window beside the left bar.
  - The right margin marker sits outside the editor in a non-scrolling wrapper, so it
    never moves, can't be selected, takes no clicks and is not printed. The text box's
    right padding (the gutter, 56 px) is exactly the marker's distance from the right
    edge, so text wraps at the line.
  - Very long words also wrap there, rather than running past it.
- **Scrollbars:** `::-webkit-scrollbar { width: 0 }` on every element hides vertical
  scrollbars in Chromium and Safari and leaves horizontal ones (for example a wide table)
  alone. Firefox has no per-axis setting, so there `scrollbar-width: none` hides both.
  Scrolling is unaffected.
- **Show invisibles**
  - It is a ProseMirror decoration plugin: spaces and tabs are wrapped in spans, and line
    breaks and paragraph ends get empty widgets. The glyphs (·, →, ↵, ¶) are drawn by CSS
    `::after`, so they are not even text in the page.
  - The note's JSON, the clipboard (copied from the document model), search and backups
    never see them.
  - The setting is stored in `localStorage` (`jot.showInvisibles`).
  - It stays enabled on read-only notes through a per-button "always enabled" exception
    to the disabled toolbar.
  - Tiptap 3 keeps an empty paragraph after a final heading, so that paragraph shows a ¶
    too.
- **Show empty lines** mirrors Show invisibles in its own module (`emptyLines.ts`): a node
  decoration puts a class on each empty top-level paragraph or heading and CSS `::after`
  draws the 4 px dot 18 px left of the text. Empty lines inside lists, quotes and tables get
  no dot (it would collide with bullets and borders). Stored in `localStorage`
  (`jot.showEmptyLines`), off by default, and always enabled like the pilcrow.

- **No rules for New (owner decision, replacing "one intent creates one note").** Every
  activation of a New button creates a note. The in-flight flag, the held keystrokes, the
  blur of the button and the reuse of an empty open note are all removed, so a
  double-click makes two notes and keys typed before the editor is ready are not kept.
  The reason: the flag could stay set when opening the new note failed (anything but a
  404), which left the New buttons dead and the keyboard swallowed until a reload. With
  no flag there is nothing to get stuck.
- **Delete empty notes (owner request).** Two routes: `GET /api/empty-notes` answers
  `{ count }` and `DELETE /api/empty-notes` answers `{ trashed }`.
  - Empty is judged on the server from the saved note: blank title (after trimming), no
    tags, and a body made only of paragraphs with nothing in them. Read-only, Inbox and
    trashed notes are left out. An edit not saved yet does not count, so a note being
    typed in another tab is safe once its first save lands.
  - The notes go to the trash (not deleted for good), in one transaction, so a mistake is
    undone from the Trash screen. There is no Undo button for the batch.
  - The owner chose the header button (left of + New) with a confirmation: the same
    second-click pattern as Empty trash, shown as a banner under the header.
- **A new note opens ready to type.** Both New buttons create the note through one function, which
  marks the new note's id in a set kept in the page's memory. When the editor has loaded
  that note, it takes the mark (once) and puts the caret at the end of the body
  (`editor.commands.focus('end')`). Focus is not set earlier, because it would be lost
  when the editor replaces the loading screen. Not the title and not the Add tag box:
  the owner asked to type straight into the body. Opening an existing note, following a
  link to it or reloading it finds no mark, so the focus is left alone as before. Nothing
  is typed or formatted: the first keystrokes are plain text, as with a click.
- **The /new address (bookmark).** A small screen in `App.tsx` calls the same
  `createAndOpenNote` as the New buttons, with one option the buttons do not pass.
  - `replace`: the note's address replaces `/new` (`history.replaceState`), so `/new` is
    never in the history. Back and Refresh land on the note, not on `/new`.
  - React StrictMode runs effects twice in development; a ref lets only the first run
    create.
  - Logged out, `/new` goes to `/login?next=%2Fnew` and back to `/new` after logging in.
    `next` is honoured only when it is exactly `/new` (an allow-list, so no open redirect
    and no other address changes behaviour); anything else goes to `/` as before.
  - No server change: the server already answers unknown GET addresses with `index.html`,
    and `GET /new` changes nothing. The note is made by the page's `POST /api/notes`.
- **The New buttons are links to /new (owner request).** Both render through
  `NewNoteLink`: an `<a href="/new" role="button">`, so tests and screen readers still find
  a button, and the browser's link actions (drag to bookmarks, copy address, open in a new
  tab) reach `/new`. A plain left click and Enter are intercepted and Space is handled by
  hand (links ignore it), all calling `createAndOpenNote` as before. Clicks with a modifier key
  or another mouse button are left to the browser.

- Font sizes are whole pixels from 6 to 200. Text with no size is 16 px Inter.
- **Applying a style with nothing selected** changes only what is typed next, as Bold
  does; text already written is left alone. (Originally it stamped the whole current
  paragraph; changed at the owner's request, see the entry near the end.)
- A stamp replaces font, size, text colour, bold, italic, underline, strikethrough and
  highlight. It leaves inline code and links alone.
- Style names are 1–60 characters; two styles may share a name. Styles are listed by name.
- A style may keep using a font that has since been archived (its card says "archived"),
  but new styles and the font pickers only offer active fonts.
- "Save selection as style…" opens the style form pre-filled from the formatting at the
  caret (falling back to Inter 16 px when the text has no font or size).
- Colours outside the palette are dropped when the note is saved. (External pasted text
  carries no colours at all; see the paste rules below.)
- **External paste is plain text; internal Jot copy/cut preserves formatting** (owner
  request; originally all pastes were plain text, see the entry near the end). One
  ProseMirror `pasteProps` (`src/client/editor/paste.ts`) decides every copy, cut and paste.
  Ctrl+V and the browser's Paste menu both arrive as the same paste event.
  - On `copy` and `cut` inside Jot (including copying from read-only notes), Jot writes the
    usual `text/plain` and `text/html` (so copying out to another app still works) plus its
    native ProseMirror selection slice (`slice.toJSON()`) under `application/x-jot-slice`.
  - When pasting into Jot with a valid `application/x-jot-slice`, Jot reconstructs the
    ProseMirror slice (`Slice.fromJSON`) and inserts it directly, preserving all fonts,
    sizes, colours, highlights, bold/italic/underline/strike, inline code, links, headings,
    lists, quotes, code blocks, horizontal rules, tables and photos across notes and tabs.
  - External pastes (no `application/x-jot-slice`, or `Ctrl+Shift+V` plain-text paste)
    always go through ProseMirror's plain-text path: external clipboard HTML is never parsed
    into the note (if there is no plain text but there is HTML, only the HTML's text is
    used). Each line becomes a paragraph, runs of blank lines are folded, and pasted plain
    text takes the formatting at the cursor.
  - Tiptap's paste rules (Markdown-style `**bold**`, `==highlight==`, … and URL
    auto-linking on paste) and the link extension's "paste a URL over selected text makes
    a link" are switched off, because they would turn pasted text into formatting. Typing
    keeps its input rules (e.g. a URL typed then followed by a space still becomes a link).
- Colour pickers (owner feedback) show swatches only: no colour names as visible text.
  Each swatch has its colour name as its accessible label and as a hover tooltip. The
  text colour picker's first swatch (a crossed-out square) is "Default text colour"; the
  highlight picker's is "No highlight". The current colour is marked selected.
- Table controls offer Tiptap's standard commands: add/delete column, add/delete row,
  header row, header column, merge cells, split cell and delete table. Columns resize by
  dragging their border.
- **Lists line up (owner request).** Bullet and numbered lists used the browser's 40 px
  indent while task lists had their own 4 px, so task text started about 15 px left of the
  others. Now all three share one rule in `styles.css`:
  - Item text starts 28 px in from the paragraph edge, and each nested level steps in
    another 28 px, mixed nesting included. 24 px was tried first, but a two-digit `10.` is
    27 px wide in 16 px Inter and stuck out past the paragraph edge. Three digits (`100.`)
    still hang about 9 px into the page margin, which is wide enough not to clip them.
  - Bullets and numbers hang in that gutter. A checkbox is 16 px wide, 4 px in from the
    paragraph edge with an 8 px gap, so its text lands on the same 28 px and the box sits
    beside its text the way a bullet or number does (owner feedback: flush at the edge
    with a 12 px gap, it looked detached from the other markers).
  - Bullets keep the browser's disc, circle, square. Numbers go 1. a. i. by numbered-list
    depth and round again (written out to nine levels; deeper stays i.). A list with its
    own `type` (1 a A i I, which the server allows) keeps it. Tiptap leaves `type="1"` out
    of the page, so it could not be told from "no type"; Jot's numbered list
    (`extensions.ts`) writes it.
  - Items are 4 px apart, paragraphs inside items have no margin, the whole list has a
    paragraph's spacing after it, and a nested list adds no gap after itself.
  - The checkbox sits on the first line's baseline (2 px below it, to centre on the
    capitals), so it stays with the text whether that line is 10 px or 40 px. Measured
    the same in Chromium, Firefox and WebKit on a test page.
  - The task-item rules now match only a task list's own items,
    `ul[data-type='taskList'] > li`. They used to match every `li` inside a task list,
    which hid the bullets and numbers of lists nested in a task. They cannot key on the
    item's `data-type="taskItem"`: Tiptap's task-item node view builds the `li` in the
    editor without it (it only has `data-checked`). `tests/component/editor-extras.test.tsx`
    checks the selector against the editor's real DOM.
  - Note text is only drawn by the editor (read-only notes and printing use the same
    `.note-body` styles); cards show plain preview text, and backups and the agent's
    Markdown carry no styling, so nothing else needed changing.

## Photos

- Photos are added through Insert → Image or by pasting (owner request; dragging files
  in is still not supported).
  - **Paste an image:** when the clipboard has no usable text (nothing but white space)
    and holds a file, that file is the photo. An image file wins over other files.
  - JPEG, PNG, GIF and WebP pass a type check in the browser and are uploaded through the
    same route as Insert → Image, so the server still decides the type from the file's
    first bytes. The photo is inserted at the cursor as an ordinary Jot photo
    (`/api/photos/<id>`), with the usual controls and corner handles.
  - Any other type shows "Photos must be JPEG, PNG, GIF or WebP images." and nothing is
    uploaded. A failed upload shows the server's reason. Either message appears in the
    note's alert banner, and nothing is inserted.
  - When the clipboard holds both text and an image (some apps put both), the text is
    pasted, as plain text, and the image is ignored.
  - An image that is only in the clipboard's HTML (an `<img>` with an external or `data:`
    URL and no image file) is never inserted, since pasted HTML is never parsed.
- A photo in a note can only point at Jot's own `/api/photos/<id>`; external and
  `data:` image URLs are removed when saving.
- Resize: a width box with −/+ (20 px steps), an "Original size" button, and grab
  handles on all four corners while the photo is selected (owner feedback). Widths
  are 40–4000 px; the height always follows the aspect ratio.
- Corner handles are 14 px accent squares with a white edge and a faint dark ring (so
  they show on white photos too), centred on the photo's outer corners, border
  included, so they sit correctly at any border width (0–10 px). Cursors: ↖↘ corners
  `nwse-resize`, ↗↙ corners `nesw-resize`. Dragging a corner outwards grows the photo
  and inwards shrinks it. Whichever way the mouse moved further (vertical movement
  scaled by the aspect ratio) decides the new width, so diagonal and vertical drags
  work too. The width box follows live while dragging; the width is saved when the
  mouse button is released (one undo step). Mouse only; touch drags are not supported.
- The stored width is the photo's outer width including its border (the box the
  handles sit on); the picture inside shrinks by the border so the outer size stays
  as set.
- Tiptap's built-in resizable image view only applies `width` when it is created, so
  width changes from the photo controls would not show until a reload. Jot therefore
  extends the Image node with its own small node view that re-applies width and
  border on every change.
- A border wider than 0 px with no colour chosen uses Jet. Choosing a border colour on a
  photo with no border also sets the border to 2 px, so the choice is visible.
- Photo files stay on disk when a note is deleted permanently (the same photo can be in
  several notes, and nothing in the spec asks for clean-up).

## Fonts

- The catalogue comes from Google's public family metadata
  (`fonts.google.com/metadata/fonts`, no API key), cached by the server for 24 hours.
- Adding a font downloads the regular and bold weights, upright and italic, where the
  family has them (the nearest weight to 400 if it has no regular). Other weights are
  synthesised by the browser. All of Google's unicode subsets are downloaded, as woff2.
- Adding a font that is already archived restores it; the Fonts screen also has a
  Restore button on archived fonts. Fonts can never be deleted.
- **Default fonts (owner request).** The five starter fonts can never be archived.
  - They are recognised by family name against the starter list (`src/shared/starter.ts`).
    A user has at most one font per family, and starter fonts can't be deleted, so the
    name is enough: no schema change and no new flag.
  - The font list says `isDefault`. The Fonts screen shows "Default font" where the
    Archive action would be, on the user's font chips and on the catalogue card.
  - The archive route refuses with 400 "<Family> is a default font and cannot be
    archived.", for every user. It checks ownership first, so another user's font is
    still 404.
  - A starter font archived before this rule is left as it is (no data migration). It
    still shows Restore, and the unarchive route still works; once restored it can't be
    archived again.
  - Archiving a font the user added, restoring it, and adding an archived family again
    work as before.
- **Default styles (owner request, reversing the earlier "starter styles are ordinary").**
  Body, Title, Quote, Aside and Code are system styles.
  - **Marking:** an `is_default` flag on the style record (schema version 4), never the
    name, so a user's own "Body" stays editable.
  - **Server:** edit, rename and delete are refused with 400 "<Name> is a default style
    and cannot be changed or deleted.", for every user. A style that is created (New
    style, or Save selection as style) is always ordinary, whatever the request says.
  - **Styles screen:** shows "Default style" instead of Edit and Delete. The editor's
    Styles dropdown and stamping are unchanged. Text stamped with a style is never touched.
  - **Standard definitions:** the starter-pack table. Body and Title keep the Jet text
    colour they were given.
  - **Migration (version 4, one transaction, runs once).** For each user and each default
    style:
    - The starter style they were given (same name, and created at the same moment as the
      account) is flagged. If it had been edited, it is set back to the standard
      definition, and only then do its dates change.
    - If it was deleted or renamed, it is created again.
    - Every other style, including a renamed former starter and a user-made style with
      the same name, is left exactly as it is.
    - Tested against a copy of a database from the previous version
      (`tests/fixtures/jot-v3.db`) with untouched, edited, renamed and deleted starter
      styles and two user-made "Body" styles.
  - One function, `ensureDefaultStyles`, guarantees "exactly one of each, standard, on the
    user's font of that family". The migration and every personal restore use it.
  - **Personal backup and restore rule.** Default styles are not user data.
    - A personal backup holds only the user's own styles.
    - A restore never touches the account's five default styles: they stay as they are,
      moved onto the restored copy of their font, and then `ensureDefaultStyles` runs.
      Every other style is replaced by the backup's.
    - Default styles in a backup are skipped. That covers a style flagged `isDefault`
      (Jot never writes one) and, in older backups, an old starter style: a default
      style's name together with a creation time equal to the backup's starter font of
      that style. That is the same "created with the account" rule as the migration.
    - A user-made style called "Body" is restored as ordinary.
    - A backup must hold the five default fonts. Old backups always do, since fonts can't
      be deleted; a backup without them is refused.
    - The manifest's style count still counts every style in `data.json`, skipped ones
      included.
  - Full system backups carry the flag in the database.
- Catalogue cards preview each family by loading only the letters of its name from
  Google when the card scrolls into view. The user's own fonts, the pickers and notes
  always use Jot's private copies and never contact Google.
- The five starter fonts ship with Jot in `assets/starter-fonts` (SIL Open Font
  License), fetched once with `scripts/fetch-starter-fonts.ts` using the same download
  code. Creating a user copies them, so the CLI never needs the network.

## Theme ("Olive")

- The owner replaced the earlier "Rose" theme with "Olive" (third round of feedback).
  Light mode only: `color-scheme: light` is declared, so browsers in dark mode do not
  restyle form controls, and no dark styles exist. The left bar is white and the
  toolbar pale; nothing in the chrome is dark, and no rose or pink remains anywhere in
  it. The end-to-end theme test checks this: it reads the computed colours of every
  visible element outside the note page and fails on any pink, rose or magenta hue.
- The owner's colours are used as given. Shades the brief did not name, each checked
  for contrast (WCAG ratios in brackets):
  - Toolbar hover is `#e4f2c4` (the chip green), not the general hover tint `#eef5dc`,
    because that tint is the toolbar's own background and hover would be invisible
    (toolbar text on it 8.7:1). Elsewhere, hover is `#eef5dc`.
  - Disabled toolbar buttons (undo/redo, etc.) and disabled table/photo control
    buttons use text `#6d775a` instead of fading with opacity (4.2:1 on the toolbar,
    4.7:1 on white: the same ratios Rose had).
  - The white font-size box has a `#85906e` edge, so it reads as a field on the pale
    toolbar (3.0:1, as in Rose; the usual minimum for input boundaries).
  - Toolbar separators are `#e0e8cd` as specified. That is only 1.1:1 on the toolbar,
    which is fine because they are purely decorative.
  - Pressed and open toolbar buttons keep the accent while hovered.
  - The Jot logo is the accent `#4d7c0f` on white (5.0:1); on the home page it takes the
    active colours (`#3f6212` on `#e4f2c4`, 6.0:1).
  - Accent hover `#3f6212` (white on it 7.1:1); soft accent for highlighted menu items
    and the user's own fonts in the catalogue `#e4f2c4`; the table and photo control
    bars and notice banners use the tint `#eef5dc` (their labels `#6b7557`, 4.4:1).
  - Errors and destructive buttons use a true red, `#b42318` (6.6:1), not a pinkish one;
    error banners are white with a red border and text. The table cell-selection overlay,
    modal backdrop and shadows are olive-tinted.
  - Measured: white on the accent 5.0:1, bar icons 4.9:1 on white, tag chips and the
    active bar item 6.0:1, toolbar text 9.2:1, body text 14.8:1, muted text 4.6:1 on
    the app background.
- Note content is not themed: the white page, the default text colour `#141414`, and
  the Vivid palette are unchanged, as are table and code-block styling inside notes.
- Favicon: `/favicon.svg`, the logo in white on the olive accent.

## Tag input fix (owner report: "cannot add more than one tag / remove a tag")

- Root cause: the "Add tag" box kept its text in React state and submitted that copy on
  Enter. Text that reaches the field without a React change event (browser autofill,
  some input methods and extensions, automation tools that set the field's value) left
  that copy empty, so Enter silently did nothing: no request and no message. The
  server's request log for the owner's session showed exactly this: no tag request of
  any kind was ever sent from the browser. Typing with a real keyboard worked in
  Chromium, Firefox and WebKit, which is why the first tests did not catch it.
- Fix: the box is uncontrolled and reads the field itself on Enter. The remove button
  on each chip is now full-strength with a larger target and a "Remove tag …" tooltip.
- Covered by `e2e/specs/tags-multi.spec.ts` (three tags, remove one, reload; once typed
  and once with the value set directly; the second failed before the fix) and by
  component tests.

## Font downloads

- A font file that fails to download is retried once before the add fails.
- When an add fails, the user still gets a short message (502), and the server logs
  the underlying cause (for example which file URL answered which status).
- Redirects are refused on all Google Fonts requests, so the allowed-host check covers
  every request.

## Deployment

- The container runs as `${JOT_UID:-1000}:${JOT_GID:-1000}` (set those if your host
  user is not 1000:1000) so files in `./data` are owned by you.
- The server runs TypeScript directly with `tsx`; the frontend is built by Vite into the
  image.
- Note bodies (JSON) may be up to 32 MB per save; photos have no limit (streamed to disk).
- TypeScript 5.9 is used for type-checking (the new 7.0 native compiler was not needed).

## Tests

- Test types 1–7 run with Vitest inside the `test` Compose service (`./test.sh`).
- Font download tests (types 1, 2, 4) use a local fake of the Google Fonts endpoints so
  they do not depend on the network; the end-to-end tests use real Google Fonts.
- End-to-end tests (type 8) run the production image in a separate Compose project
  (`jot-e2e`) with its port unpublished and a throwaway data folder, with two users
  created through the real CLI, and drive it with Playwright in its own container.
  The app is reached as `jot-app`, because Chrome forces HTTPS for the hostname `app`
  (`.app` is an HSTS-preloaded top-level domain).
- The smoke test (type 9) uses the real `docker-compose.yml` on port 9003 with a
  throwaway data folder (`./.test-data/smoke`). If your own Jot is running it is
  stopped for the test and started again afterwards.
- The end-to-end tests create a third user, carol, for the backup and unsaved-edit
  flows, so their restores never change the data the other flows use.

## Backup and restore (`backup-spec.md`, revision 9)

Built as specified, around its three ideas and one lock; nothing else was added (no
journal files, no moving live files aside, no generations or revision numbers, no extra
locks, no extra CLI commands, no admin role). Where the spec is silent:

**The lock**
- `data/.lock` is held with an exclusive SQLite transaction on that (empty) file, which
  is a POSIX file lock: the kernel releases it when the process exits or is killed, and it
  works between the app and `docker compose exec`/`run` containers on the same host. The
  journal is kept in memory, so no other file appears.
- A second backup or restore is refused at once ("Another backup or restore is running"),
  not queued. Every CLI command takes the lock, as the spec says (including the user
  commands and `jot verify`). In the web app, building a backup and confirming a restore
  take it. Uploading and checking a restore file does not, because it touches nothing live.

**Personal backup**
- Format version 2 adds `readOnly` to each note in `data.json`, so an older Jot refuses
  such a backup instead of losing the flag.
  - A version 1 backup has no flag and restores with every note writable.
  - A flag that isn't true or false is refused, and so is a read-only note in the trash
    (Jot never allows that).
  - A restore replaces every note, read-only ones included; the safety backup keeps them.
    Full system backups carry the column in the database as usual.
- Two requests. `POST /api/backup` builds the archive on disk, reads it back against its
  manifest and reports what was already missing, so the screen can say it plainly.
  `GET /api/backup/:id` then streams it and removes it from the server. If a download
  fails, the user makes a new backup.
- `data.json` holds notes (title, content, tag names, created/updated/deleted dates),
  photo records, font records (with their faces) and styles. No username or password.
- A note can point at a photo that was never this user's (note content allows any photo
  id, e.g. pasted from another account). Such a reference is listed in the manifest as
  missing, and is left as it is on restore.
- Names: `jot-backup-<username>-<YYYYMMDD-HHMMSS>.tar` (UTC).

**Restore**
- Upload: the raw file (`application/x-tar` or `application/octet-stream`). A form,
  JSON or text upload gets 415. Unconfirmed uploads are deleted when cancelled, at every
  server start, and after 24 hours. The 24-hour sweep runs whenever a user makes a backup
  or uploads a restore file and no other backup or restore is running.
- Checks, beyond the spec's list:
  - tags must already be in Jot's form (lowercase letters) and appear once per note;
  - titles over 500 characters are refused, and control characters in titles are replaced
    (that counts as an adjustment);
  - font families must be unique, and every face file name must be one Jot writes;
  - a photo's type and size come from the file itself, not the record;
  - the manifest's counts must match `data.json`.
- "Every font a note or style uses": notes name fonts by family, and note content may name
  any family (it then renders in the fallback font, as it does today). So only styles'
  fonts are checked: each style's font must be in the backup.
- Dates are restored as they were (created, updated, trashed, archived). Only ids are new.
- Step 5 places each new file with `link()` from the staged copy, which never replaces an
  existing name and needs no second copy of a large photo. The staged copy is created
  fresh in `data/staging` on the same disk, and each file is synced under its new name.
- The step 5 and step 6 lists are one table, `restore_files (path, state 'new'|'old',
  user_id)`, added as schema version 2. Tidy-up deletes every listed photo file or font
  folder and then its row. It runs at every server start, before each restore (under its
  lock), and after a restore that failed without crashing, so a failure ends exactly as a
  crash would.
- While a user's restore runs, that user's changes (any request except GET and logout)
  get 409 with code `restore-in-progress`, and the browser's autosave retries them. The
  list of restoring users is kept in the app's memory, because personal restores only
  ever run in the app process. Photo uploads and font downloads also re-check it just
  before saving their record.
- After the restore the tab reloads on the home page. Other open tabs get 404 for their
  old note ids. Their editor says the note no longer exists (a restore may have replaced
  it) and keeps the text on screen.

**Safety backups**
- Kept in `data/users/<id>/safety-backups/` as `jot-safety-<date>-<8 hex>.tar`. Each is
  built in staging and linked into place only when complete, so a crash never leaves a
  partial one. Jot never deletes them.
- They are not part of a full system backup, which already contains the data they were
  taken from. After a system restore they stay in the moved-aside old data folder.

**Archive format (both kinds)**
- Plain POSIX ustar written by Jot itself: plain files only, mode 0600, owner 0, no user
  or group names. Sizes of 8 GiB or more use base-256.
- The reader is strict. Every header must be byte-for-byte what Jot writes; padding and
  the two end blocks must be zero; nothing may follow them.
- The manifest is sealed with a `check` field: the SHA-256 of the rest of the manifest as
  compact JSON. With the per-entry SHA-256s, any single changed byte anywhere in an
  archive is refused, including inside the manifest. Without the seal, a changed date or
  count in the manifest would pass.

**Full system backup (CLI)**
- The `VACUUM INTO` copy is written as a hidden `.jot-backup-*.partial` file in the output
  folder. Sessions and any `restore_files` rows are deleted from it, then it is vacuumed
  again so the deleted rows are gone from the file. It is stored in rollback-journal mode
  (one file), and the app switches it back to WAL when it starts.
- The archive is also built as a hidden partial and linked to its final name when
  complete. A `jot backup` that was killed leaves only partials, which the next `jot backup`
  to that folder deletes.
- Name: `jot-backup-<YYYYMMDD-HHMMSS>.tar` (UTC, `-2`… if two are made in the same second).
  The `.sha256` beside it is in `sha256sum -c` format.
- "Says so each time": the same-disk note is printed whenever the backup was written inside
  the data folder (the default `data/backups`).
- `jot verify` reads either kind of backup. A personal backup gets the same checks as a web
  restore. It checks the `.sha256` file when there is one, and says when there is none.
- `jot restore`:
  - "The app is stopped" is checked by asking Jot's health endpoint at `http://app:9003`
    (the service, as seen from a `docker compose run` container) and
    `http://127.0.0.1:$PORT` (the same container). A stopped app leaves no trace in the
    data folder, and a running one may be serving the moved-aside folder.
    `JOT_APP_URLS` overrides the addresses (for tests).
  - Besides `backups`, the empty data folder may contain `.lock`.
  - Files are extracted straight into the data folder, created fresh, after a full verify.
  - On failure it removes `jot.db` (and any journal) and `users/`, never `backups`.
- Run it as `docker compose run --rm app jot restore /data/backups/<file>`. With the app
  stopped, `exec` is not possible, and `run` mounts the new empty `./data`.

**The three fixes (§5)**
- `jot-spec.md`'s "backup is a copy of `data`" now points to `jot backup`. A folder copy is
  safe only with the app stopped.
- Photos: the file, the photos folder and the user folder are synced before the record is
  saved. Fonts: each downloaded file, the font's folder and the fonts folder. New users'
  starter font copies follow the same rule.
- Unsaved edits are kept in `localStorage` under `jot.unsaved.<user id>.<note id>` until a
  save is confirmed.
  - Failed saves are retried after 2, 5 and 10 seconds, then every 30 seconds, for network
    failures, server errors, 429 and `restore-in-progress`/`busy`. They are not retried for
    a missing note, a refused edit or a trashed note.
  - The editor shows "Not saved" with the reason until a save succeeds.
  - When a note opens with edits this browser kept, they are put back and saved. A kept
    edit wins over a version saved elsewhere in the meantime, because Jot has no merge.
  - Logout clears the user's kept edits. Nothing more is kept for that user in that page
    until they log in again, so the editor's last save attempt failing after logout
    cannot bring the text back.

**Tests (all in the existing nine types, `./test.sh`)**
- Env-guarded failpoints (`JOT_FAILPOINT=<step>`, `<step>:throw`, `<step>:sleep=<ms>`)
  stop a backup or restore at exact steps. They do nothing when the variable is unset,
  as it always is in production.
- The crash tests run Jot's real server as a child process and kill it with SIGKILL at
  each step of a personal restore.
- Where each test lives:
  - Type 1: backup isolation.
  - Type 2: personal round trip, recent saves, backup while writing, unclean content,
    missing files, staging, safety backup, old tab, one at a time, failures part-way, the
    disk-sync fix, and a 2.5 GiB photo with memory below 300 MiB.
  - Type 3: tar, manifest, names, photo remapping, sanitiser stability.
  - Type 4: bad and crafted backups, upload kinds, origins, safety backup names.
  - Type 5: system round trip, guards, failed and killed restores, verify, missing files,
    backups while writing, the lock after a crash, the lock shared with the web app.
  - Type 6: crash at every step, tidy-up after a committed restore, schema version 2.
  - Type 7: Account page (backup parts), left bar, unsaved edits.
  - Type 8: back up, delete, restore; old tab; unsaved edit through a reload; another user.
  - Type 9: `jot backup`/`verify` in the container, restore guards (also from a `run`
    container), and the owner's full restore procedure.

## Agent notes (`agent-spec.md`)

Built as specified: an MCP server at `/mcp`, bearer tokens per bot, the Inbox, three
tools. Nothing the spec does not ask for (no sessions, no per-token permissions, no
read/unread tracking, no rate limiting, no extra tools).

**Libraries (pinned, checked against their current documentation and type definitions)**
- `@modelcontextprotocol/sdk` 1.32.2 (latest on npm, 2026-10-23), the MCP TypeScript SDK.
  The server follows its documented stateless Streamable HTTP pattern
  (`examples/server/simpleStatelessStreamableHttp`):
  - each POST builds a new `McpServer` and a `StreamableHTTPServerTransport` with
    `sessionIdGenerator: undefined`, passes Fastify's parsed body to `handleRequest`, and
    closes both when the response closes;
  - GET and DELETE answer 405;
  - `enableJsonResponse: true` answers with plain JSON instead of an event stream.
  Tools are declared with `registerTool(name, { description, inputSchema: <zod shape> },
  handler)` and return `{ content: [{ type: 'text', text }] }`, or `isError: true` with a
  message. The tests and the end-to-end test use the SDK's own `Client` with
  `StreamableHTTPClientTransport` and an `Authorization` header in `requestInit`.
- `zod` 4.6.7 (the SDK's peer dependency, for the tool argument shapes).
- `markdown-it` 15.0.3 (latest, 2026-10-16), a maintained CommonMark parser.
  - Options: `html: false` (raw HTML stays literal text), `linkify: false`,
    `typographer: false`.
  - Its token stream is mapped onto Jot's document through an allow-list. There is no
    hand-written Markdown parsing: Jot only writes Markdown back out, for `read_note`.
  - `validateLink`/`normalizeLink` are opened up so the converter sees every link as
    written. It then keeps only http, https and mailto (also through the sanitiser's
    `isSafeHref`); any other link keeps its text. markdown-it's own check would have left
    such a link as literal `[text](url)`.
- The same SDK and zod versions are in the e2e runner, for its real MCP client.

**Server**
- `/mcp` accepts only `Authorization: Bearer <token>`.
  - The scheme is case-insensitive; the token must be the whole value.
  - A login cookie is never read there.
  - The web app's routes never read the Authorization header, so a token does nothing
    there.
  - An unknown, revoked or missing token gets 401 with `WWW-Authenticate: Bearer`.
- `/mcp` is exempt from the cross-site Origin check that protects the cookie routes. It
  takes no cookie, and a bearer token is never sent by a browser on its own.
- Body limit: 50 MB on `/mcp` only (route option); every other route keeps 32 MB. Over the
  limit, /mcp answers 413 "The request is larger than 50 MB, the limit for /mcp."
- Logging: the Fastify logger redacts `authorization` and `cookie` headers wherever a
  log line carries them. Fastify's default request log has no headers anyway. A test
  reads the real log stream and finds no token.
- "Last used" is updated on every request a token makes.
- Tokens are `jot_` plus 32 random bytes (base64url), stored as given (the owner's
  decision), unique. Names are 1–40 characters on one line, unique per user and
  case-sensitive (so "Claude" and "claude" can both exist). The Account list sorts them
  ignoring case.
- `request_id` (1–200 characters) is stored on the note, unique per user, bot name and
  request id. A retry, even two at once, returns the note already made. "The same bot" is
  the same bot name, so a bot whose token was replaced under the same name still gets its
  retries matched.
- A restore of the user's data refuses `create_note` while it runs, like the web app's
  changes.

**Notes and the Inbox**
- Schema version 6 (one migration) adds to notes `inbox` (0/1), `bot_name` and
  `bot_request_id`, and the `bot_tokens` table. Existing notes get `inbox = 0`.
  It is tested against a copy of a version-5 database.
- The home page's list, its tag filter and tag chips, and its search leave Inbox notes out.
  The Inbox lists them newest first by creation.
- Keep (`POST /api/notes/:id/keep`) clears the flag. Like every other change, it is refused
  on a read-only or trashed note.
- The left bar's Inbox item sits after New note. Its count is fetched again on each move
  between screens; there is no polling.

**create_note**
- Order of checks: tags, `request_id`, images (base64 and image bytes), so any problem
  refuses the whole request before anything is written.
- The photo files are then written and synced, and the photo records and the note are
  saved in one transaction. A failure removes the files.
- An image's type comes from its bytes, not `mime_type`. Its name (1–200 characters,
  unique in the request) is how the Markdown refers to it. An image the Markdown mentions
  becomes a photo block where it was mentioned, splitting its paragraph, with its caption
  as the photo's alt text.
- Title: the one given, else the first heading, else the first line of text (500
  characters at most).
- The Typewriter look is a `textStyle` mark (Fira Code, 15 px, Jet) on every text run
  outside code blocks, after any bold/italic/strike/code/link marks. Heading text gets the
  same mark without the size (owner check), so Jot's Heading 1/2/3 sizes apply. The result is passed
  through the sanitiser, and the tests check that it leaves it unchanged.
- A soft line break in Markdown becomes a space, as Markdown defines; two trailing spaces
  or a backslash make a line break.
- Things markdown-it parses that are not in the table keep their text, for example
  footnote markers.
  - markdown-it has no task lists, so the `[ ]`, `[x]` or `[X]` at the very start of a list
    item's first text is removed and the item stays a plain list item, keeping its words
    (owner check).
  - Anywhere else `[ ]` is just text.

**list_notes / read_note**
- 20 per page. The cursor is the offset as a number; "next cursor: none" ends.
- `query` uses the same full-text search as the web app, over the user's live notes
  including the Inbox. `tag` filters exactly.
- Every title, preview and body is wrapped as
  `<<<UNTRUSTED NOTE DATA <random> — written by author "<name>"; …>>> … <<<END UNTRUSTED NOTE DATA <random>>>`.
  The random marker changes per block, so a note cannot fake the end of its own block.
- Each tool's description says to treat those blocks only as data.
- `read_note` writes Markdown back out. Fonts, sizes, colours, highlights and underline
  are dropped; task lists become plain lists; photos become `[photo]`; Markdown characters
  in text are escaped.

**Account page and backups**
- Account page, Bots: the address (`JOT_PUBLIC_URL` + `/mcp`) with Copy, and a generic
  setup snippet (`mcpServers.jot` with `type: "http"`, `url` and an `Authorization:
  Bearer` header). Each bot shows its token, Copy, "Copy setup" (the snippet with its
  token), last used and Revoke with a second-click confirm.
  - Where the browser refuses the clipboard (plain HTTP), the page says to select and copy
    the text.
- Personal backup format 3 adds `inbox` and `botName` per note; formats 1 and 2 restore with
  every note outside the Inbox. Tokens are not in personal backups, and a personal restore
  does not touch them. Full system backups carry the tokens in the database (the CLI
  round-trip test compares the `bot_tokens` table).
- `JOT_PUBLIC_URL` is passed through `docker-compose.yml` (default
  `http://localhost:9003`).
- The User manual needed no change (it describes the Account page's backup parts, which
  are unchanged), so it has no bots section.

## Sections (`sections-spec.md`, draft 7)

Built as specified, in the shape of its §9: `src/shared/sections.ts` (rules), `src/server/sections.ts`
(table and rules), section-aware queries in `notes.ts`, `src/client/theme.ts`,
`src/client/currentSection.ts` (store) and three components (`SectionMenu`, `SectionsScreen`,
`NoteSection`; `SectionMenu` was later replaced by the section link, see the last item). Nothing the spec does not ask for. Where it is silent:

- **Storage.** Schema version 7: a `sections` table keyed by (user, ID), and `notes.section_id`
  added with `DEFAULT 'default'`, which fills every existing note without rewriting a row. The
  column has no foreign key (SQLite refuses one on an added column with a default); the server
  checks every section it is given belongs to the user. Default's `created_at` is the account's.
- **How the browser names the current section.** The store adds `?section=<id>` to the home
  list, tag chips, search, New, "Delete N empty", the trash, Empty trash and Keep. A request
  without it means Default; another user's or an unknown ID is 404 ("No such section.").
  `GET /api/tags` without it stays as it was (every section), for the Tags page.
- **Routes.** `GET/POST /api/sections`, `PATCH /api/sections/:id` (name and/or colour; an `id` in
  the body is ignored), `POST /api/notes/:id/section` to move. No DELETE route.
- **Rules.** The ID uses the tag rules, including lowercasing ("Work" becomes "work"). The name
  is trimmed, 1–60 characters. A duplicate ID is 409. Default can be renamed and recoloured.
- **Note count** on a section card counts live notes outside the Inbox (what its home page shows).
- **Moving** does not change the note's dates. Refused with 403 (read-only) or 409 (trashed).
  An Inbox note can be moved; it stays in the Inbox.
- **Opening a note** makes its section current, except an Inbox note: the Inbox is not divided
  by section, so opening a bot's note from it leaves the current section alone and Keep still
  goes where the button says.
- **Restore puts a note back in its own section**, whichever section is current. Restore and
  Delete permanently name the note, so they take no section.
- **The current section** is in local storage under `jot.section.<user id>`. Until the list of
  sections has loaded the interface uses the remembered ID and Olive for a moment; a remembered
  section that is not in the list becomes Default. If the list cannot be loaded, only Default is
  shown.
- **Switching** from a card's Open goes to the home page without a tag filter.
- **Theme.** The eight values are CSS variables on `<html>`; every other chrome variable in
  `styles.css` is built from them. Logging out removes them, so the login page is Olive. The
  one-off Olive shades listed in "Theme (Olive)" above are replaced as the spec says: toolbar
  text uses Accent dark, disabled text and the toolbar size box edge use Muted, and the margin
  marker's line uses Border (the nearest of the eight to `#b4c88c`). Shadows and the modal
  backdrop keep their faint olive tint in every section.
- **Section square** shows the first character of the name, uppercased. The Sections page's dialog checks the rules in the browser first
  (the shared rules) and shows the server's message otherwise.
- **The note's section control** sits after the tags. On a read-only or trashed note it shows
  the section but is disabled.
- **Personal backup format 4** adds `sections` (ID, name, colour, created) and `section` on each
  note. The manifest's counts are unchanged. An older backup restores with one Default section
  (Olive) holding every note: a restore replaces, so sections made since are gone, as notes made
  since are.
- **Tests.** `tests/isolation/sections-isolation.test.ts`, `tests/api/sections.test.ts`,
  `tests/unit/sections.test.ts`, `tests/db/migration-v7.test.ts` (against
  `tests/fixtures/jot-v6.db`, made with the version 6 code from `jot-v5.db` plus a bot note and a
  tag), `tests/component/sections.test.tsx`, `e2e/specs/sections.spec.ts`. Existing tests changed
  only where the spec changed what they check (the URLs with `?section=`, format 4, schema 7,
  the four theme shades, the left bar's controls).
- **Trash per section, on the Sections page (owner request, draft 8).** The left bar's Trash
  link is gone. Each section card has a Trash button (trash-can icon and "Trash <n>", also
  "Trash 0") after Edit and Open; it makes the section current and goes to the unchanged
  `/trash` route. `GET /api/sections` gives each section a `trashCount` beside `noteCount`:
  every trashed note of that section, Inbox ones included, which is what its Trash screen
  lists. The Trash screen's heading is "Trash — <section name>" (the app's spaced em dash).
  The button's accessible name is "Trash of <name> (<n> notes)". The e2e specs that used the
  left bar link now open the trash through the `openTrash` helper (section menu → Manage
  sections → the current section's card).
- **The section button is a link (owner request, draft 9).** The left bar's square under the
  logo no longer opens a menu: it is a plain left bar link to `/sections` (accessible name
  "Sections (current: <name>)"), marked active there like the other links. The menu, its
  "Manage sections" item and its CSS are gone; `SectionMenu.tsx` became `SectionMarks.tsx`
  (the square and the colour dot, shared by the left bar, the cards and the note's section
  control). Switching is done with Open on a Sections page card. The current card's mark is
  shortened to "Current" so Edit, the mark and Trash fit on one line. The e2e helpers switch
  and open the trash through the Sections page.
- **Deleting a section; the "Current" corner tag (owner request, draft 10).** This reverses
  "sections cannot be deleted". `DELETE /api/sections/:id` (owner only; unknown ID 404;
  Default refused with 400 "The Default section cannot be deleted.") moves every note of the
  section to Default in one transaction (one `UPDATE notes SET section_id`, so trashed notes
  land in Default's trash, Inbox and read-only notes move too, and nothing else about a note
  changes, not even its updated date), then removes the section row; it answers
  `{ moved: n }`. The ID can be used again afterwards. The Edit dialog has a danger Delete
  (not for Default) that swaps the buttons for an in-dialog confirmation ("Delete Bob's Work?
  Its 3 notes and 2 trashed notes move to Default.", built by `deleteSectionMessage` in the
  shared rules from the card's counts, naming Default by its current name), with "Keep it"
  and "Delete section". Deleting the current section makes Default current. Personal backup
  needs no change: it saves the sections that exist and a restore replaces them. The current
  card's button-row mark became a small uppercase "Current" pill in the card's top-right
  corner; that card's buttons are Edit and Trash.
- **Previous / Next note in the editor (owner request).** Two chevron buttons left of Move
  to trash walk the note's section in home page order (`updated_at DESC, id`, live notes,
  no tag filter or search) and wrap. No new route: the editor reads `GET
  /api/notes?section=<the note's section>` once to know whether there is another note
  (hidden for trashed and Inbox notes and a section's only note), and again at the click,
  after `autosave.flush()` (the same save the trash and move buttons do), so a note just
  edited counts from the top. A note no longer in the list at the click does nothing.
  Tests: `tests/component/note-nav.test.tsx`, `e2e/specs/note-nav.spec.ts`, and the home
  order is pinned in `tests/api/notes.test.ts`.
- **Save as PDF (owner request).** A toolbar button just left of the lock calls the
  browser's own `window.print()`; the user picks "Save as PDF" in the print dialog. No
  server-side renderer or PDF library (no new dependency, no image change), and the PDF
  is the page as the browser already draws it: the user's fonts, colours, photos and
  tables, with selectable text. The click saves pending edits (`autosave.flush()`), waits
  for `document.fonts.ready` and the note's photos, and sets `document.title` to the note
  title while the dialog is open (the suggested file name), restoring it afterwards. The
  `@media print` block at the end of `styles.css` hides everything but the title and body
  and undoes the app's fixed heights and scrolling so long notes run over many pages.
  Tests: `tests/component/save-pdf.test.tsx`, `e2e/specs/save-pdf.spec.ts`.
- **End-of-note marker (owner request, mockup variant 4 "Rule with label").** A `::after`
  pseudo-element on the editor element (`.note-body`) draws a 1px Border-colour rule with
  END in the middle just below the last block. CSS only, so it is never in the note's
  content, saves, backups or copies; `pointer-events: none` keeps clicks below the text
  placing the caret at the end as before. No toggle. Hidden in the `@media print` block.
  Tests: `tests/component/end-marker.test.tsx`, `e2e/specs/end-marker.spec.ts`.
- **Note title in the browser tab (owner request).** While a note is open the tab reads
  `<note title> · Jot` (`Untitled · Jot` when the title is empty or only spaces), set by an
  effect in `NoteEditor.tsx` that follows the title as it is typed (not only once saved)
  and puts `Jot` back when the note is left. Every other screen stays `Jot`. Save as PDF
  still swaps in the bare note title while the print dialog is open (the suggested file
  name) and then restores the tab title it found.
  Tests: `tests/component/tab-title.test.tsx`, `e2e/specs/tab-title.spec.ts`.
- **Inline code chip (owner request).** Inline code inside note content (`.note-body code`)
  is styled as a violet chip: `#f3e9ff` background, `#7a1fd6` text, `1px solid #dcc2fb`
  border, `5px` radius and `0.1em 0.4em` padding (keeping `Fira Code` and `0.9em`). Code
  blocks are unchanged: `.note-body pre code` also resets `border: 0` and `border-radius: 0`
  so it does not pick up the chip edge. Tiptap renders `textStyle` outside `<code>` and
  `highlight` (`<mark>`) inside `<code>`, so `.note-body span[style*='color'] code { color:
  inherit; }` lets an explicit text colour win over the default violet without affecting
  font-only spans, and `<mark>`'s inline background naturally wins inside the chip. Other
  `code` elements outside `.note-body` (such as `.bot-address code` on the Account page)
  are untouched, and `@media print` prints the chip as drawn.
  Tests: `tests/component/inline-code.test.tsx`, `e2e/specs/inline-code.spec.ts`.
- **Selected horizontal line is visible (owner report).** Arrowing onto a horizontal line
  selects the line itself (a ProseMirror node selection), so the text caret is gone, and
  the selected-node outline is switched off for the whole note body: the cursor seemed to
  vanish. A selected line is now drawn 3px thick in the section's accent colour with a
  soft accent halo (`.note-body hr.ProseMirror-selectednode`, a `box-shadow`, so the text
  around it does not move). Keyboard behaviour is unchanged: another arrow press moves on,
  Backspace or Delete removes the line. The accent is used as for selected table cells.
  Test: `e2e/specs/hr-selected.spec.ts`.
- **Back to notes button in the editor header (owner request).** A third square icon button
  (`.rail-toggle-btn`, lucide-react `List` icon) sits in `.note-header-actions` right after
  Collapse/Expand sidebar and New note, before the title, so returning to the notes list is
  reachable even when the sidebar is collapsed. Accessible name and tooltip are "Back to
  notes". It is a real `<a href="/">` link (middle-click and modified clicks open `/` in a
  new tab; a plain left-click calls `navigate('/')` in-app without a full reload), shown
  whenever the editor header is shown (including read-only, Inbox and trashed notes, with
  the sidebar expanded or collapsed), and hidden by the existing `@media print` rules.
  Pending edits are flushed by `useAutosave`'s unmount cleanup when leaving the note.
  Tests: `tests/component/back-to-notes.test.tsx`, `e2e/specs/back-to-notes.spec.ts`.
- **Style buttons (owner request).** Ten fixed per-user toolbar shortcuts (numbered 1–10,
  coloured in order from `PALETTE[slot - 1].text` in `src/shared/palette.ts`).
  - **Schema v8 (`style_buttons`).** Keyed by `(user_id, slot)` with `slot CHECK (1..10)`,
    `style_id REFERENCES styles(id) ON DELETE SET NULL`, `hidden INTEGER NOT NULL DEFAULT 0`,
    and `user_id REFERENCES users(id) ON DELETE CASCADE`. Stored sparsely: a missing row
    means unbound and shown (no backfill needed for existing users), and updating a slot back
    to unbound + shown deletes its row. Deleting a style clears bindings via `ON DELETE SET NULL`.
  - **API (`src/server/buttons.ts`, `src/server/app.ts`).** `GET /api/buttons` returns all ten
    slots in order 1–10; `PATCH /api/buttons/:slot` validates the slot (strict integer 1–10)
    and patch body (`styleId` and/or `hidden`, refusing unknown fields/types via shared
    `src/shared/buttons.ts`) and verifies ownership of `styleId` (another user's style ID
    returns the same 400 "Choose one of your styles." as a non-existent one).
  - **Backup format 5 (`src/server/backup/personal.ts`).** `data.json` adds `buttons`: ten
    entries `{ slot, styleId, defaultStyle, hidden }`. User styles are referenced by ID (remapped
    to new IDs on restore); default styles are referenced by standard name (`Body`..`Code`) so
    bindings survive restores across accounts and never collide with a user style of the same
    name. Older backups (versions 1–4) restore with all ten buttons unbound and shown. Full
    system backups (`jot.db`) carry `style_buttons` automatically.
  - **Client.** `ButtonsScreen` at `/buttons` (reached from a "Buttons" link in `Sidebar`
    between Styles and Account, `LayoutGrid` icon), synced through `DataProvider` so changes
    appear in the editor toolbar without reload (and deleting a style on `/styles` reloads
    buttons too). Every slot shows its chip (outlined when unbound), style picker previewed in
    each style's look plus "No style", and an eye toggle (faded with crossed-out eye when
    hidden); no delete control. In `Toolbar.tsx`, `StyleButtonGroup` sits immediately after
    Link (absent with its separator when no button is bound and shown), disabled wherever
    `ToolbarDisabled` is true, and uses `.tb-style-btn` (separate from `.tb-btn`) so the in-use
    state renders only the 3 px rounded underline in the button's colour (no filled background).
    `uniformFormat(editor)` in `src/client/editor/stamp.ts` walks all text nodes overlapping a
    non-empty selection and returns `null` when style-relevant marks differ across the selection
    (or no text is selected), ensuring no button is underlined on mixed formatting.
  - **Tests.** `tests/unit/buttons.test.ts`, `tests/db/migration-v8.test.ts` (against
    `tests/fixtures/jot-v7.db`), `tests/api/buttons.test.ts`,
    `tests/isolation/buttons-isolation.test.ts`, `tests/component/buttons.test.tsx`,
    `e2e/specs/buttons.spec.ts`, plus updates to `tests/api/backup.test.ts`,
    `tests/api/sections.test.ts`, `tests/cli/backup-cli.test.ts`,
    `tests/security/security.test.ts`, `tests/security/backup-security.test.ts`,
    `tests/db/migration-v7.test.ts`, `tests/db/restore-crash.test.ts`,
    `tests/helpers/backup.ts`, and `tests/component/backup.test.tsx`.
- **Style button preview tooltips (owner request).** Replaced the native `title` attribute on
  the toolbar's ten style buttons (`StyleButtonGroup` in `src/client/editor/Toolbar.tsx`)
  with Jot's own preview tooltip (`.style-tooltip` in `src/client/styles.css`); all other
  toolbar buttons keep their native `title`.
  - **Content and look:** a small light card matching `.menu` (`var(--surface)`, border,
    radius, shadow, `z-index: 20`, `pointer-events: none`), showing the style's name in small
    muted text above the word `Sample` styled with `stylePreviewCss` (the same helper, font
    quoting and 30 px size cap used by the Styles dropdown).
  - **Positioning and viewport clamping:** each button sits in a `position: relative`
    `.tb-style-item` wrapper and the tooltip is `position: absolute; top: calc(100% + 6px);
    left: 50%; width: max-content;` with `transform: translateX(calc(-50% + var(--tip-shift, 0px)))`
    so it never shifts the toolbar layout. `.toolbar` and `.toolbar-wrap` do not clip
    overflow (`z-index: 5`), while `.main` has `overflow: hidden`; a `useLayoutEffect`
    measures the rendered tooltip and sets `--tip-shift` to keep it at least 8 px inside both
    the window and `.main` (re-checked on window resize).
  - **Behaviour and accessibility:** opens after a 150 ms hover delay (preventing flicker
    while sweeping across the row) or immediately on keyboard focus, and hides immediately on
    mouse leave, blur, Escape (via a document keydown listener so Escape works on hover too)
    or click. Never shown on disabled buttons (read-only notes); touch taps set a short
    synthetic-mouse guard and hide immediately so a tap cannot leave a tooltip stuck open.
    Buttons keep `aria-label="Style button N: <name>"` with no `title` and no
    `aria-describedby` (so screen readers do not read the style name twice); the tooltip
    carries `role="tooltip"`.
  - **Tests:** `tests/component/buttons.test.tsx`, `e2e/specs/buttons.spec.ts`.
- **A style with nothing selected applies to what is typed next (owner request).** It used
  to select and restyle the whole current paragraph, so pressing a style button at the end
  of a sentence restyled the sentence. Now `applyStyle` (`src/client/editor/stamp.ts`)
  never changes the selection: with an empty selection its mark commands set the stored
  marks, so only the text typed next takes the style, and choosing another style then
  typing gives one phrase in two styles. With text selected it stamps the selection as
  before. The Styles dropdown and the style buttons share the command, so both changed.
  To restyle a whole paragraph, select it first (a triple click).
  Tests: `tests/component/dropdowns.test.tsx`, `e2e/specs/style-typing.spec.ts`.
- **Clear formatting with nothing selected resets only what is typed next (owner request).**
  It used to select and clear the whole current paragraph, so clicking Clear formatting at
  the end of a formatted sentence stripped formatting from the whole line. Now
  `clearFormatting` (`src/client/editor/clear.ts`) leaves existing text and blocks alone
  when the selection is empty and only runs `tr.setStoredMarks([])`, resetting the toolbar
  to normal so continued typing is plain. `currentFormat` (`src/client/editor/stamp.ts`)
  now reads `state.storedMarks ?? state.selection.$from.marks()` at a collapsed caret so
  the toolbar reflects emptied `storedMarks` (Tiptap's `getAttributes` falls back to
  `$head.marks()` even when `storedMarks` is `[]`). With text selected, Clear formatting
  clears marks and blocks as before. To clear a whole paragraph, select it first (a triple
  click).
  Tests: `tests/component/editor-extras.test.tsx`, `e2e/specs/editor-extras.spec.ts`.
- **Internal copy/cut/paste preserves formatting while external paste stays plain text
  (owner request).** Previously `pasteProps` (`src/client/editor/paste.ts`) stripped
  formatting even on copies from Jot itself. Now `copy` and `cut` inside the editor write
  the ProseMirror selection slice (`slice.toJSON()`) under `application/x-jot-slice`
  alongside the usual `text/plain` and `text/html`. When pasting into Jot with a valid
  `application/x-jot-slice`, `handlePaste` restores the slice with `Slice.fromJSON` and
  inserts it (passing through plugin `handlePaste` handlers such as table cell paste
  first), preserving all inline formatting, blocks, links, tables and photos across notes
  and tabs (and from read-only notes). External pastes and `Ctrl+Shift+V` carry no Jot
  slice and continue to paste as plain text taking the cursor's formatting.
  Tests: `tests/component/paste.test.tsx`, `e2e/specs/paste.spec.ts`.
- **Custom styles and fonts appear above defaults everywhere (owner request).**
  - `/styles` (`StylesScreen.tsx`) splits into **Your styles** on top (showing a muted empty
    notice when none have been created yet) and **Default styles** below.
  - `/fonts` (`FontsScreen.tsx`) splits the top fonts panel into **Your fonts** (user-added,
    with an empty notice when none have been added yet), **Default fonts** below it, and
    **Archived** underneath when present.
  - The editor toolbar's Styles and Font dropdowns (`Toolbar.tsx`) and the `/buttons` style
    picker (`ButtonsScreen.tsx`) list custom items on top (or a muted empty note), a
    horizontal separator line (`.menu-sep`), and default items below. The New/Edit Style
    dialog's Font `<select>` (`StyleDialog.tsx`) likewise groups custom fonts above defaults.
  Tests: `tests/component/fonts-trash.test.tsx`, `tests/component/dropdowns.test.tsx`,
  `e2e/specs/defaults-empty-trash.spec.ts`.
