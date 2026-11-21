# Jot — sections specification

- **Status:** draft 8 (2026-11-20): draft 7, cut down for simplicity on the owner's instruction, plus the trash moved onto the Sections page. Built.
- **Adds to:** `jot-spec.md`, `agent-spec.md`, `backup-spec.md`. Where this document and those disagree, this one wins; section 11 lists what it changes.
- **In one line:** every note belongs to one section (such as Work or Recipes); the user is always "in" one section, sees only its notes, and the whole interface takes that section's colour.
- **Mockups:** https://claude.ai/artifact/BKEFkADCqCtakTeydTRNNb. The owner chose **A2** (Sections page as cards), **B1** (switch from a menu in the left bar) and **C2** (whole interface tinted).

**The rule for this document and the build (owner):** simplicity beats completeness. Jot has about three users. Anything not written here is left as it is today, and rare timing cases (two tabs, a restore in another tab) are deliberately not specified. When the builder meets a case this document does not cover, they pick the simplest behaviour.

---

## 1. What a section is

- A top-level area of a user's notes: "Work", "Recipes". Sections are per user.
- **Every note belongs to exactly one section.**
- Every user has a **Default** section, created with the account.
- Sections can be renamed and recoloured. **They cannot be deleted.**
- Tags, fonts and styles are unchanged and shared by all of a user's sections.

| Field | Rules |
|---|---|
| **ID** | Letters a–z only, 1 to 30 characters (the tag rules). Unique among the user's sections. Set at creation and never changes. Example: `recipe`. Default's is `default`. It is the section's only identifier. |
| **Name** | What the interface shows, for example "Bob's Recipes". 1 to 60 characters. Can be changed. |
| **Colour** | One of the six colours in section 5. Can be changed. |

Sections are listed with Default first, then in the order they were created.

## 2. The current section

- A logged-in user is always in one section, the **current section**.
- The browser remembers it (local storage, per user), so **reloading or reopening Jot stays in the same section**. If nothing is remembered, or the remembered section does not exist, it is Default.
- Opening a note by its address (`/n/<id>`) makes that note's section current.

| Screen or action | Behaviour |
|---|---|
| Home page list and its tag filter chips | The current section's notes and their tags |
| Search | The current section's notes |
| New note (both New buttons and `/new`) | Created in the current section |
| "Delete N empty" | The current section's empty notes |
| Trash | **Each section has its own trash.** The Trash screen, Restore, Delete permanently and Empty trash work on the current section's trashed notes. The screen's heading says whose trash it is ("Trash — Bob's Work"). It is opened from the section's card on the Sections page (section 4); the left bar has no Trash |
| Tags page, Inbox, Fonts, Styles, Account | **Unchanged from today.** Not divided by section; they just take the current section's colours. Clicking a tag opens the current section's home page filtered by it |

## 3. Switching section (mockup B1)

- The left bar gets a **section button** under the Jot logo: a square in the section's accent colour showing the first letter of its name.
- Clicking it opens a menu of the user's sections: colour dot and name, with a tick on the current one.
- Choosing a section makes it current, recolours the interface and goes to its home page.
- Below the list, **Manage sections** opens the Sections page.
- The home page heading is the current section's name ("Bob's Work").

## 4. The Sections page (mockup A2), `/sections`

- One card per section, drawn in that section's own colours: its name, its ID, its number of notes, an **Edit** button, **Open** (or a "Current section" mark) and a **Trash** button.
- **Trash** shows a trash-can icon and the number of the section's trashed notes ("Trash 2", and "Trash 0" when it is empty). Clicking it makes the section current and opens the Trash screen (`/trash`), which shows that section's trash.
- A **+ New section** card opens a dialog: Name, ID and Colour. The dialog says the ID cannot be changed later. Errors (empty name, invalid ID, ID already used) are shown in the dialog.
- **Edit** opens the same dialog with the ID fixed: the name and colour can be changed.
- There is no Delete.

## 5. Colour (mockup C2)

- The whole interface chrome takes the current section's colour.
- Six colours, each one set of the same eight values. No special cases, no free colour picker, no rose or pink.
- **Olive** is today's theme and Default starts as Olive. A few of today's one-off Olive shades (toolbar text, disabled text, toolbar input edges, the margin marker's line) now use the nearest of the eight values; the difference is barely visible.
- Not affected by section: the note page and note content, danger red, the login page and the tab icon (always Olive).

| Colour | Accent | Accent dark | Soft | App bg | Border | Hover | Text | Muted |
|---|---|---|---|---|---|---|---|---|
| Olive | `#4d7c0f` | `#3f6212` | `#e4f2c4` | `#f7f9f1` | `#e0e8cd` | `#eef5dc` | `#1d2610` | `#6b7557` |
| Blue | `#1d4ed8` | `#1e3a8a` | `#dbe7ff` | `#f3f6fd` | `#d3def5` | `#e8effc` | `#111a33` | `#5a6685` |
| Violet | `#7c3aed` | `#5b21b6` | `#eadfff` | `#f8f5fe` | `#e2d8f7` | `#f0e9fd` | `#1f1433` | `#6c6085` |
| Amber | `#b45309` | `#8a3f06` | `#fde8c8` | `#fdf8f0` | `#f0e0c6` | `#faefdc` | `#2b1c0a` | `#7a6a55` |
| Teal | `#0f766e` | `#115e59` | `#ccf2ec` | `#f2f9f8` | `#cfe6e2` | `#e3f3f0` | `#0d2422` | `#55706c` |
| Slate | `#475569` | `#334155` | `#e2e8f0` | `#f6f7f9` | `#dde2ea` | `#eceff4` | `#151a22` | `#5b6472` |

| Value | Used for |
|---|---|
| Accent | Buttons, selected chip, pressed toolbar buttons, New button, logo, focus ring; with white text |
| Accent dark | Chip text, active left bar icon, editor toolbar text and icons, button hover |
| Soft | Tag chips and the active left bar item |
| App bg, Border, Text | Page background; borders and separators; text |
| Hover | Hover tint and the editor toolbar background |
| Muted | Muted text, left bar icons, disabled text |

## 6. Moving a note

- The note editor header shows the note's section beside the tags. Clicking it opens a menu of the user's sections; choosing one moves the note, and the app follows it to its new section.
- **A read-only note cannot be moved.** It must be unlocked first with `jot unlock-note`.
- A trashed note cannot be moved; restore it first.
- A move changes only the note's section.

## 7. Inbox and bots

- A bot's note is created in the **Default** section, in the Inbox, as today.
- The Inbox screen is unchanged and shows every Inbox note whichever section is current.
- **Keep** takes the note out of the Inbox and puts it in the current section. The button says where ("Keep in Bob's Work").
- Bots are otherwise unchanged: the same three tools, with the same inputs and outputs. They see notes from all sections, as today.

## 8. Existing data and backups

- **Database version 7** adds a `sections` table and a section on every note.
- The upgrade gives every existing user a Default section (ID `default`, name "Default", Olive) and puts all of their notes in it. A new account gets the same.
- The upgrade adds a column to the notes table and fills it in; it does not rebuild the table. Existing notes are not rewritten.
- **Personal backup becomes format version 4** (3 is already in use). It adds the user's sections and each note's section ID. A restore checks that every note names a section in the backup and that there is a `default` section. Older backups restore with every note in Default.
- **Full system backup:** no change.

## 9. How the build is divided

Each part has one job, so sections can be understood, tested and changed on their own.

| Part | Its one job |
|---|---|
| Sections module (server) | Owns the `sections` table and every section rule: validation, list, create, rename, recolour, the Default section |
| Notes module (server) | Same shape as today. The functions behind the screens in section 2 take a section and add it to their queries |
| Shared rules | ID and name validation and the list of colours, used by server and client, as the tag rules are today |
| Theme (client) | One file maps each colour name to its eight values and sets them as CSS variables. Components use only the variables |
| Current section (client) | One small store holds the current section, remembers it in the browser, and adds it to requests |
| Screens (client) | The section menu, the Sections page and the note's section control: three separate components that use the store |

The server checks that a section belongs to the logged-in user, as it does for everything else. No new dependency is needed.

## 10. Tests

All nine existing test types still apply. The new tests:

- **Isolation:** one user can never see, use or change another user's sections, including when both have a section with the same ID.
- **Sections:** create, rename, recolour; ID rules; duplicate ID refused; ID cannot be changed; no way to delete.
- **Scoping:** the home list, tag chips, search, new note, "Delete N empty" and the trash each work on the current section only.
- **Moving:** a move changes only the section; read-only and trashed notes cannot be moved.
- **Inbox:** bot notes land in Default; Keep puts the note in the current section.
- **Upgrade:** a version 6 database gains a Default section holding every note, with tags intact.
- **Backups:** sections survive a personal backup and restore; an older backup restores into Default.
- **End to end:** create "Work" and "Recipes"; a note made in Work is not on the Recipes home page, in its search or in its trash; switching changes the colours; a reload stays in the same section; move a note and follow it.

## 11. What this changes in the other specifications

- `jot-spec.md` §3 "tags are the only organisation": sections are now a level above tags.
- `jot-spec.md` §3 New note, Trash, Empty trash, Delete empty notes, and §5 Search: each works on the current section.
- `jot-spec.md` §11 and §12: Olive becomes one of six colours; new Sections screen; the left bar gains the section button and loses Trash (each section's trash opens from its card).
- `agent-spec.md` §3: bot notes land in Default; Keep puts a note in the current section.
- `backup-spec.md` §3: personal backup format 4.

## 12. Out of scope

- Deleting a section.
- A note in more than one section; sections inside sections.
- Moving several notes at once.
- Tags, fonts or styles that belong to one section.
- A view of all notes across every section.
- Anything for bots about sections.
- More colours or a free colour picker.

## 13. Decisions

By the owner, 2026-11-20: a Default section; every note in one section, movable; each section has its own trash, opened from its card on the Sections page (no Trash in the left bar); a read-only note must be unlocked before moving; one ID per section; six uniform colours; sections can be renamed but not deleted; simplicity first.

Chosen here where the owner was silent, each the simplest option:

1. Bot notes land in Default; Keep puts them in the current section.
2. The Tags page stays exactly as it is today, across all sections.
3. The current section is remembered once per browser, not per tab.
4. Bots are not told about sections.
