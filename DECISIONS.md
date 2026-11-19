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
  Trash and Log out. There is no notes icon and no tags icon.

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
- There is no separate Tags page (owner feedback; `/tags` is gone and shows "Not
  found"). The home page filter is the only way to browse by tag. It lives in the URL
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

## Editor and styles

- **Clear formatting** is one Tiptap chain, so one transaction and one undo step.
  - With nothing selected it first selects the current paragraph, and puts the cursor
    back where it was afterwards.
  - Tiptap's `clearNodes` turns headings, list items, task items, quotes and code blocks
    into paragraphs. It cannot lift anything out of a table cell, so tables stay. Photos
    are untouched.
  - It then unsets textStyle (font, size, colour), highlight, bold, italic, underline,
    strikethrough and inline code, but not links, and empties the "next typed" marks.
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

- **A new note opens ready to type.** Both New buttons create the note through one function, which
  marks the new note's id in a set kept in the page's memory. When the editor has loaded
  that note, it takes the mark (once) and puts the caret at the end of the body
  (`editor.commands.focus('end')`). Focus is not set earlier, because it would be lost
  when the editor replaces the loading screen. Not the title and not the Add tag box:
  the owner asked to type straight into the body. Opening an existing note, following a
  link to it or reloading it finds no mark, so the focus is left alone as before. Nothing
  is typed or formatted: the first keystrokes are plain text, as with a click.

- Font sizes are whole pixels from 6 to 200. Text with no size is 16 px Inter.
- **Applying a style with nothing selected** stamps the whole current paragraph (and
  the formatting carries on while typing in an empty paragraph).
- A stamp replaces font, size, text colour, bold, italic, underline, strikethrough and
  highlight. It leaves inline code and links alone.
- Style names are 1–60 characters; two styles may share a name. Styles are listed by name.
- A style may keep using a font that has since been archived (its card says "archived"),
  but new styles and the font pickers only offer active fonts.
- "Save selection as style…" opens the style form pre-filled from the formatting at the
  caret (falling back to Inter 16 px when the text has no font or size).
- Colours outside the palette are dropped when the note is saved. (Pasted text carries no
  colours at all; see the paste rules below.)
- **Paste is always plain text** (owner request). One ProseMirror `handlePaste` decides
  every paste. Ctrl+V and the browser's Paste menu both arrive as the same paste event.
  - The clipboard's `text/plain` is pasted through ProseMirror's own plain-text path, so
    pasting into a code block still keeps the text as code. If there is no plain text but
    there is HTML, only the HTML's text is used (block elements become new lines).
  - The clipboard's HTML is never parsed into the note, whether it came from another app,
    a web page or Jot's own copy (styled text, headings, table cells). So no fonts, sizes,
    colours, highlights, bold, italic, links, headings, lists, tables or images come from
    the clipboard.
  - Each line becomes a paragraph. Runs of blank lines are folded, so Jot's own copy of
    two paragraphs (which puts a blank line between them) comes back as two paragraphs,
    not three.
  - The pasted text gets the formatting at the cursor, exactly as a typed character
    would: the pending formatting if one was just switched on, else the marks at the
    cursor. A link stops at its end, so pasting just after a link is not linked.
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
  - Type 7: Backup screen, left bar, unsaved edits.
  - Type 8: back up, delete, restore; old tab; unsaved edit through a reload; another user.
  - Type 9: `jot backup`/`verify` in the container, restore guards (also from a `run`
    container), and the owner's full restore procedure.
