# Jot — specification

Jot is a private, multi-user note-taking web app with a rich-text editor, per-user fonts and named text styles.

- **Status:** approved for build by the owner on 2026-11-18.
- **Date:** 2026-11-18
- **Reference screenshots:** `reference-screenshots/` (an app called Inkwell; Jot follows its look and toolbar, minus folders and inbox)

---

## 1. Goals and constraints

- Runs with Docker Compose.
- Serves HTTP on port 9003.
- Multi-user, fewer than 10 people, low traffic.
- No sharing: nothing one user owns is ever visible to another.
- User administration only through a CLI.
- Correctness matters more than build speed.

## 2. Accounts

- Login with username and password; logout.
- The web app has no sign-up, no account settings and no password change.
- Users cannot be deleted.
- Each user owns their own fonts, styles, notes, tags and photos.
- A new user receives their own copy of the starter pack (section 10).

### CLI (the only user admin, and the full system backup)

| Command | Does |
|---|---|
| Create user | Creates the account with a username and password, and gives it the starter pack |
| Update password | Sets a new password for an existing user and ends that user's existing sessions |
| List users | Shows the existing accounts |
| `jot backup` | Writes a full system backup to `data/backups/` (or `--out` another folder) and prints its name and SHA-256 (`backup-spec.md` §4) |
| `jot verify <file>` | Checks a backup completely without changing anything |
| `jot restore <file>` | Rebuilds the system from a backup into an empty data folder, with the app stopped |
| `jot unlock-note <note id>` | Makes one read-only note writable again (the id is the last part of the note's address, `/n/<note id>`); prints the note's title and owner; says so when the id does not exist or the note is not read-only. Works with the app running. It is the only way to turn read-only off |

Run inside the container with `docker compose exec`; `jot restore` runs with the app stopped, through `docker compose run --rm app`.

## 3. Notes

- A note has a title, a body and tags.
- No folders and no inbox; tags are the only organisation.
- Notes list shows title, preview text, tags and relative time ("3 min ago").
- Created and updated dates are shown on each note, in the status line (section 6). Dates are in the viewer's own time zone.
- Each note has its own URL.
- New note button.
- A note made with a New button (the + in the left bar or + New on the home page) opens with the text cursor in the note body, ready to type without a click. Opening an existing note does not move the cursor into the body.
- Every press of a New button creates a note. Nothing is guarded or reused: a double-click makes two notes, and pressing New in an empty note makes another.
- **Delete empty notes.** When the user has empty notes, the home page header shows a button, left of + New, with how many ("Delete 3 empty"). An empty note has no title, no tags and nothing in the body (a photo, a table or a rule counts as something); read-only notes, Inbox notes and trashed notes are never counted. Clicking it asks once more in the page ("3 empty notes will move to the trash.", Confirm: delete empty, Cancel). Confirming moves them all to the trash in one action, where they can be restored, and the page says how many were moved. The button is not shown when there are none.
- The address `/new` (for a bookmark) always makes a new note and opens it ready to type, as a New button does, showing "Creating note…" meanwhile. The address becomes the note's own (`/n/<id>`) in place of `/new`, so Back and Refresh never make a second note. Logged out, `/new` goes to the login page and the note is made after logging in. If the create fails, the page shows the error and a Try again button.
- Both New buttons are links to `/new`: they can be dragged to the bookmarks bar, copied, or opened in a new tab (middle-click, Ctrl/Cmd/Shift-click), where `/new` makes the note. A plain click, Enter or Space makes the note in place.

### Read-only notes

- A note can be made read-only with the lock toggle at the end of the editor toolbar. Turning it on asks once more in the page, saying plainly that once read-only nothing about the note can be changed, it cannot be deleted, and it can only be made writable again from the command line on the server.
- Once read-only, nothing about the note can change through the web app: not the title, not the body, not its tags, and it cannot be moved to the trash or deleted. The server refuses every such request with a clear message (403). A note in the trash cannot be made read-only.
- In the editor a read-only note shows a "Read-only" indicator. The title and body are not editable, the tag box, tag remove buttons and trash button are not shown, and the formatting toolbar is disabled. Text can still be selected and copied. The note still appears in the list (with a lock mark), the tag filter and search.
- The web app has no way to turn read-only off; only `jot unlock-note <note id>` on the server does (section 2).

### Agent notes (Inbox)

Specified in `agent-spec.md`. Bots (AI assistants with an MCP client) write notes into a user's Inbox and read that user's notes through Jot's MCP server at `/mcp`, each with a token the user makes on the Account page.

- A note a bot writes is an ordinary note marked as in the Inbox and carrying the bot's name (kept after Keep and after the token is revoked).
- Inbox notes appear only on the Inbox screen (newest first, with the bot's name), not on the home page, in its search or in its tag filter. Keep moves a note into the user's notes. They can be opened, edited, tagged, made read-only or trashed like any note.
- Bots cannot change, tag, keep, trash or delete any note.

### User manual

- Every user has a read-only note titled "User manual", tagged `manual`. New accounts get it with the starter pack; existing accounts got it once, from the schema migration that added read-only notes.
- It is written with the starter styles and headings, and covers: backing up your own data, restoring your own data (with the safety backup), the full system backup from the command line (the exact commands), and read-only notes with `jot unlock-note`.

### Trash

- Deleting a note moves it to the trash.
- From the trash a note can be restored or permanently deleted.
- **Empty trash** permanently deletes every note in the user's trash in one action. It asks once more in the page, saying how many notes will be deleted and that this cannot be undone, and is not shown when the trash is empty. It touches only the user's own trashed notes. Photos stay on disk, as with permanent delete, and tags and search stay consistent.
- Trashed notes do not appear in the notes list or in search.

## 4. Tags

- Letters a–z only, 1 to 30 characters.
- Uppercase input is converted to lowercase ("Demo" becomes "demo").
- Anything else is rejected with a message: digits, hyphens, spaces, accents, or more than 30 characters.
- Added inline on the note.
- Browsed through the tag filter on the home page (section 12): a tag appears as a chip while at least one non-trashed note uses it, and choosing it filters the list.
- The Tags page (`/tags`) lists every such tag with its number of notes. A tag can be deleted there after an in-page confirmation: it is removed from every note that has it and the notes are kept. A tag that a read-only note has cannot be deleted.
- Clicking a tag's name on a note (in the editor header or on a note card in the list) opens the home page with that tag's filter selected.
- Tags are per user.

## 5. Search

- Searches note text and tags.
- Returns only the logged-in user's notes, and never trashed ones.

## 6. Editor

Built on Tiptap. Opening a note shows the editor full screen (everything except the left bar): a header with the title, tags, the Keep button (Inbox notes) and the trash button, then the toolbar, the note page and a status line. No notes list is shown beside it.

The **status line** is a thin bar (28 px, muted 12.5 px text, a line above it) pinned at the bottom of the note screen, under the writing area; it stays put while the note scrolls. Left to right: the word count and character count of the note body ("21 words", "1 character"; counted from the text, spaces included, updated as you type), the save status (nothing while there is nothing to save), the Read-only label and the "From <bot>" label when they apply; at the right, "Created <date> · Updated <relative time>". It is always one row: when the window is narrow, "Created …" shortens and then goes, keeping the updated time. It is shown on trashed and read-only notes too, is not printed, and its text cannot be selected.

The toolbar matches the screenshots, left to right:

1. **Styles** dropdown: the user's styles previewed in their own look, then "Save selection as style…" and "Manage styles…"
2. **Font** dropdown: the user's active (non-archived) fonts previewed in their own typeface, then "Browse fonts…"
3. **Font size:** minus, number box, plus
4. **Text colour** and **highlight colour**: colour swatches only, with no colour names as visible text (each swatch keeps an accessible label); then **Clear formatting** (tooltip "Clear formatting"): with text selected it removes all formatting from the selection (font, size, text colour, highlight, bold, italic, underline, strikethrough, inline code) and turns headings, list items and block quotes in it back into normal paragraphs, keeping the text, links, tables and photos; with nothing selected it does the same to the current paragraph. Either way what is typed next is plain (the toolbar shows no style, Inter, 16). One undo step
5. **Bold, italic, underline, strikethrough, inline code, link**
6. **Heading** dropdown: Normal text, Heading 1, Heading 2, Heading 3
7. **List** dropdown: Bullet list, Numbered list, Task list
8. **Insert** dropdown: Horizontal line, Block quote, Table, Image
9. **Undo** and **redo**, then **Show spaces, tabs and line ends** (a toggle): a muted dot for each space, an arrow for each tab, a return mark at a line break and ¶ at the end of each paragraph. Display only: nothing is added to the note, saved, copied, searched or backed up. Remembered per browser, and enabled on read-only notes too (it changes nothing)
10. **Read-only** toggle (a lock): makes the note read-only after an in-page confirmation (section 3)

The writing area uses the full width of the window beside the left bar. A right margin marker shows where lines wrap: a faint 1 px vertical line (#b4c88c) down the full height of the writing area at the right edge of the text, topped by a small downward-pointing accent-green (#4d7c0f) triangle just under the toolbar, with a gutter to its right. Text wraps exactly at the line. The marker stays put while the note scrolls and is never part of the note.

Links: Ctrl+click (Cmd+click on a Mac) opens a link in a new tab (noopener, noreferrer); a plain click places the cursor so the link text can be edited, and the link shows the hint "Ctrl+click to open". In a read-only note a plain click opens it. A web address typed into a note (https://… followed by a space or Enter) becomes a link; links made with the link button behave the same. Only http, https and mailto links.

No vertical scrollbar is drawn anywhere in Jot (pages, the editor, lists, menus, dialogs); scrolling with the wheel, trackpad, touch and keyboard still works.

Shown only when relevant:

- **Table controls** when the cursor is in a table: Tiptap's standard table features (add and remove rows and columns, header row, merge and split cells, column resize).
- **Photo controls** when a photo is selected: resize, border size, border colour (swatches only, like the colour pickers).

Pasting (Ctrl+V or the browser's Paste menu) always inserts plain text: all formatting from the clipboard is stripped (fonts, sizes, colours, highlights, bold, italic, links, headings, lists, tables), whether the text comes from another app, a web page or Jot itself. Lines are kept as paragraphs, and the pasted text takes the formatting at the cursor, as typed text would. Pasting an image is described in section 7.

## 7. Photos

- Uploaded and stored by Jot; private to the user.
- Standard image types: JPEG, PNG, GIF, WebP.
- Added with Insert → Image, or by pasting: when the clipboard holds an image file (a screenshot, or an image copied from another app or web page) and no usable text, the image is uploaded like Insert → Image and inserted at the cursor as a normal Jot photo. A type other than JPEG, PNG, GIF or WebP, or a failed upload, shows a clear message and inserts nothing. An external or `data:` image URL is never inserted. If the clipboard holds both text and an image, the text is pasted.
- No size limit and no cap on how many.
- Resizable in the note: when a photo is selected, clearly visible grab handles appear on all four corners (accent-coloured squares with a white edge, with resize cursors). Dragging any corner resizes the photo keeping its aspect ratio, within 40–4000 px wide, and the width box in the photo controls stays in sync. The handles sit on the photo's corners at any border size.
- Border from 0 px to 10 px; default 0 (no border).
- Border colour chosen from the 10 border colours.

## 8. Fonts

- Each user downloads fonts from Google Fonts into their own private collection.
- A browsable, searchable catalogue with each font previewed in its own typeface.
- Fonts cannot be deleted, only archived.
- The five starter fonts (section 10) are default fonts and can never be archived: the Fonts screen shows "Default font" instead of an Archive action, and the server refuses. A starter font archived before this rule keeps its Restore action, and once restored cannot be archived again. Fonts the user added can be archived and restored.
- An archived font disappears from the pickers, but every style and note that already uses it keeps working.
- No limit on the number of fonts.

## 9. Styles

- Each user creates their own named styles.
- No limit on the number of styles.
- Create, edit and delete styles; save the current selection as a style.
- **Default styles.** The five default styles (Body, Title, Quote, Aside, Code; section 10) are part of the system: every user has exactly one of each, and no one can edit, rename or delete them. The server refuses with a clear message, and the Styles screen shows "Default style" in place of Edit and Delete. They are marked by a flag on the style record, not by name, so a style the user makes (even one called "Body") is an ordinary style that stays editable and deletable. Default styles are in the editor's Styles dropdown and stamp text like any other. "Save selection as style" always makes an ordinary style.
- **A style is a stamp.** Applying it copies its formatting onto the text. Editing the style afterwards does not change that text unless the style is applied again. Deleting a style leaves text that used it unchanged.

A style is made of:

| Part | Required? |
|---|---|
| Name | Yes |
| Font | Yes |
| Size | Yes |
| Bold | Optional |
| Italic | Optional |
| Underline | Optional |
| Strikethrough | Optional |
| Text colour | Optional |
| Highlight colour | Optional |

## 10. Starter pack

Every new user gets their own copy of 5 fonts and 5 styles, and the read-only "User manual" note (section 3). The 5 fonts are default fonts, which cannot be archived (section 8). The 5 styles are default styles, which cannot be edited, renamed or deleted (section 9); this table is their standard definition.

Fonts: Inter, Lora, Playfair Display, Caveat, Fira Code.

| Style | Font | Size | Options | Text colour | Highlight |
|---|---|---|---|---|---|
| Body | Inter | 16 px | none | Jet | none |
| Title | Playfair Display | 40 px | Bold | Jet | none |
| Quote | Lora | 20 px | Italic | Violet | none |
| Aside | Caveat | 24 px | none | Electric | none |
| Code | Fira Code | 14 px | none | Jade | none |

## 11. Colours

A fixed palette ("Vivid"): 10 text colours, 10 highlight colours and 10 photo border colours. There is no free colour picker. The pickers show colour swatches only; each swatch carries an accessible label with its name.

| Name | Text | Highlight | Photo border |
|---|---|---|---|
| Jet | `#141414` | `#C7C7C7` | `#292929` |
| Crimson | `#E00631` | `#FF8FA5` | `#F9103F` |
| Tangerine | `#F55A00` | `#FFB88F` | `#FF640A` |
| Sunflower | `#CC9C00` | `#FFE58F` | `#FFC60A` |
| Lime | `#5B9C11` | `#CBFF8F` | `#8BE723` |
| Jade | `#089163` | `#8FFFDA` | `#16F3A9` |
| Cyan | `#0099B8` | `#8FECFF` | `#0AD6FF` |
| Electric | `#0A47FF` | `#8FABFF` | `#0A47FF` |
| Violet | `#8F2AF4` | `#C78FFF` | `#8516F3` |
| Magenta | `#E90CA6` | `#FF8FDD` | `#F316B1` |

### Interface theme ("Olive")

The app's own interface (not note content) uses the "Olive" theme, light mode only; there is no dark mode. Nothing in the interface chrome is dark: the left bar is white and the editor toolbar pale. No rose or pink appears anywhere in the chrome. The note page itself stays white, and the Vivid palette above is unchanged for note content.

| Element | Colour |
|---|---|
| Accent (buttons, selected filter chip, pressed toolbar buttons, new-note button, logo) | `#4d7c0f` with white text |
| App background | `#f7f9f1` |
| Borders and separators | `#e0e8cd` |
| Text | `#1d2610` |
| Muted text and left bar icons | `#6b7557` |
| Tag chips and the active left bar item | background `#e4f2c4`, text/icon `#3f6212` |
| Hover tint | `#eef5dc` |
| Editor toolbar | background `#eef5dc` (1px bottom border), text and icons `#32470f`; pressed/open buttons in the accent with white |
| Cards, inputs, menus, the left bar (1px right border) and the note page | `#ffffff` |
| Toolbar size box and dropdown menus | white with dark text |

## 12. Screens

| Screen | Contents |
|---|---|
| Login | Username, password. Any address goes here when logged out, and to the home page after logging in, except `/new`, which is kept (section 3) |
| Notes (home page) | Search box, New button, a tag filter (chips for the user's tags; choosing one filters the list; "All" clears it) and the notes list. Each note card has a trash button that moves the note to the trash at once, with Undo (read-only notes have none). No editor beside the list. Clicking a tag's name on a note opens this page with that tag selected |
| Note | The open note full screen (everything except the left bar): title, tags, toolbar and the note page. No notes list beside it. A read-only note shows a "Read-only" indicator and cannot be edited |
| Fonts | Google Fonts catalogue with search; add a font; the user's fonts with an archive action (none for the five default fonts, which say "Default font"), and Restore for archived ones |
| Styles | The user's styles as cards showing each one's parts; New, Edit, Delete |
| Trash | Trashed notes with Restore and Delete permanently, and Empty trash (with an in-page confirmation) |
| Tags (`/tags`) | Every tag with its number of notes; each name opens the home page filtered by it; Delete (with an in-page confirmation) removes the tag from every note and keeps the notes |
| Inbox (`/inbox`) | Notes bots wrote and the user has not kept yet, newest first, each with its bot's name and a Keep button. See `agent-spec.md` |
| Account (`/account`) | The logged-in user's username at the top, then Back up my data (download); Restore from a backup (choose a file, see a summary, type RESTORE to confirm); Safety backups (download or delete). See `backup-spec.md` §3.1. Then Bots: the address for bots (from `JOT_PUBLIC_URL`) and a setup snippet for a generic MCP client; create a bot by name; each bot's token always visible with Copy, Copy setup, its last-used time and Revoke (with a second-click confirm). No password change or other account settings (user administration is the CLI's). (The full system backup is described in the User manual note, not on this page.) There is no `/backup` page any more |

A left bar links the screens. From the top: the Jot logo (clicking it goes to the home page) the New note button, the Inbox (with the number of notes in it) and Tags; at the bottom: Fonts, Styles, Account (a person icon), Trash and log out. It has no notes icon. The bar is 48 px wide with 36 px buttons.

---

## 13. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript everywhere | Tiptap is a JavaScript library, so server, browser and CLI share one language |
| Backend | Node.js with Fastify | One small server for the API, uploads and the built frontend on port 9003 |
| Frontend | React with Vite | Tiptap's best-supported pairing |
| Editor | Tiptap | Required |
| Database | SQLite, one file in `data` | No separate database container; ample for ten users |
| Search | SQLite FTS5 | Built in; indexes note text and tags |
| Passwords | Argon2id hashes | Current standard for password storage |
| Sessions | Server-side sessions in an HTTP-only cookie | Simple and revocable |
| Photos and fonts | Per-user folders in `data` | Served only through a logged-in route that checks ownership |
| CLI | A command in the same codebase | Reuses the server's database and hashing code |
| Deployment | One container in Docker Compose with `./data` bind-mounted | Nothing else to operate |

### Storage: the `data` bind mount

No Docker volume. A `data` folder next to the Compose file is bind-mounted into the container and holds all of Jot's state.

```
data/
  jot.db               the SQLite database
  .lock                the one backup/restore lock (backup-spec.md §2)
  backups/             full system backups made by `jot backup`
  staging/             backup uploads and downloads in progress
  users/
    <user id>/
      photos/          uploaded photos
      fonts/           downloaded Google Fonts files
      safety-backups/  taken automatically before each personal restore
```

- Backup and restore are specified in `backup-spec.md`, which supersedes this document for them. `jot backup` is the supported backup; copying `data` is safe only with the app stopped (while Jot runs, a copy can miss recent saves or be corrupt). A full restore goes into an empty data folder with `jot restore`.
- Removing or rebuilding the container leaves `data` untouched.
- The container runs as the host user, so `data` is not left owned by root.
- `data` is listed in `.gitignore`.

### How specific features are implemented

- **Named styles:** a custom Tiptap command that stamps font, size, options and colours onto the selection as plain formatting. That is what makes a style a stamp.
- **Private Google Fonts:** when a user adds a font, the server downloads the font files into that user's folder and serves them from there. Notes render without contacting Google, and archived fonts keep working because the files stay on disk.
- **Photo resize and border:** an extended Tiptap image node that stores width, border size and border colour with the photo.
- **No upload size limit:** uploads are streamed to disk, not held in memory.
- **Trash:** a "deleted at" timestamp on the note; restore clears it, permanent delete removes the row.
- **Isolation:** every row carries its owner, and every query filters by the logged-in user.

### To verify at the start of the build

- The exact Tiptap extensions and versions for font size and table column resize, against Tiptap's current documentation.

---

## 14. Testing

Everything runs in Docker. All nine test types are in scope. Tests for types 1 to 6 are written before the code they cover.

| # | Test type | What it covers | When it runs |
|---|---|---|---|
| 1 | Per-user isolation | Every route, for every kind of data (notes, tags, photos, fonts, styles, search, trash): user A can never read or change user B's | Every change |
| 2 | API integration on a real SQLite database | Login, logout, sessions, notes, tags, search, trash, photo upload, font download, styles, starter pack for new users | Every change |
| 3 | Unit | Tag rules, search query building, upload type checks, palette and style validation | Every change |
| 4 | Security | Injection through search and note content, script injection in notes, login bypass, path tricks in photo and font file names | Every change |
| 5 | CLI | Create user, update password, list users; login works afterwards; old sessions end on password change; `jot backup`, `jot verify` and `jot restore` (`backup-spec.md` §7) | Every change |
| 6 | Database | Schema setup; search index stays in sync after edit, trash, restore and permanent delete | Every change |
| 7 | Frontend component | Toolbar, style and font dropdowns, tag input, photo controls | Every change |
| 8 | End-to-end browser (Playwright against the real container) | Full flows, listed below | Every feature, and before finishing |
| 9 | Docker Compose smoke | Container starts on port 9003; everything in `data` survives a rebuild | Before finishing |

End-to-end flows:

- Log in and log out; wrong password is refused.
- Write a note with a table and a photo; reload and confirm it is saved.
- Resize a photo and set its border size and colour.
- Add a font from the catalogue and use it in a note.
- Create a style and apply it; edit the style and confirm the old text is unchanged; reapply and confirm it updates.
- Archive a font and confirm notes and styles that use it still render, and that it is gone from the pickers.
- Add valid tags; confirm uppercase is lowercased and invalid tags are rejected.
- Search by note text and by tag.
- Trash a note, restore it, then delete it permanently.
- Two users: neither can see the other's notes, tags, fonts, styles or photos.

Not tested: Tiptap's own behaviour (for example, that bold makes text bold). Only Jot's additions to it.

## 15. Build order

1. Project skeleton: Docker Compose, container on port 9003, `data` bind mount, test runner in Docker.
2. Rule tests for types 1 to 6, all failing.
3. Server: database, login and sessions, CLI, notes, tags, search, trash, photos, fonts, styles, starter pack, until those tests pass.
4. Frontend: login, notes list and editor with the full toolbar, tags, fonts, styles and trash screens, with component tests.
5. End-to-end browser tests for every flow above.
6. Docker Compose smoke test and a final full run of all nine test types.

## 16. Out of scope

- Sharing or collaboration between users
- Folders and inbox
- Sign-up, account settings and password change in the web app
- Deleting users
- Deleting fonts
- A free colour picker
- Limits on fonts, styles, photo size or photo count

## 17. Decision record

- **Agent poll on stack** (21 asked, 19 answered): Node.js 8, Python 7, Go 4; React 18, Vue 1; SQLite 17, PostgreSQL 2; Argon2 15, bcrypt 3, scrypt 1; session cookies 18, JWT 1.
- **Agent poll on tests** (21 asked, 19 answered): integration, isolation and end-to-end browser tests were each named by all 19; unit 15; security 8; CLI 7; Compose smoke 6; database 5; component 4.
- **Palette:** "Vivid" chosen from ten candidates.
- **Storage:** bind mount chosen over a Docker volume.
