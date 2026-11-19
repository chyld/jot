# Jot — backup and restore specification

- **Status:** draft, revision 9 (rewritten for simplicity, then corrected after a team review that was told not to add scope). Not built.
- **Date:** 2026-11-18
- **Adds to:** `jot-spec.md`. Where the two disagree, this document wins for backup and restore.
- **Goal:** zero data loss. A backup is complete or it says exactly what is missing. A restore completes fully or changes nothing.

## 1. Overview

| | Personal backup | Full system backup |
|---|---|---|
| Where | In the web app | On the server, through the CLI |
| Who | Every user, for their own data only | Whoever can run the CLI on the server |
| Contains | That user's notes, tags, photos, fonts and styles | Everything: all users' data plus accounts and password hashes |
| Restore means | Replace that user's data with the backup's | Rebuild the whole system from the backup |
| Protects against | A user's own mistakes | Losing everything |

There is no admin role, and no user can ever download another user's data.

## 2. Three ideas that keep this simple

Earlier drafts were complicated because they moved and replaced live files and had to recover from a crash at every step. This design avoids that.

1. **A restore never touches an existing file.** Everything restored gets a brand-new identifier, so its files have brand-new names. Nothing is overwritten, moved aside or put back.
2. **The database decides.** The switch from old data to new data is one database transaction. Before it commits, the old data is fully intact. After it commits, the new data is fully in place. There is no in-between state to recover from.
3. **A full system restore only goes into an empty data folder.** The owner moves the old `data` folder aside first. The old data is never modified, so there is nothing to roll back.

One more rule: **only one backup or restore runs at a time, across the whole system.** The web app and every CLI command take the same lock, `data/.lock`. It is an operating-system file lock, so it is released automatically if the process crashes. The safety backup inside a restore is part of that restore and runs under its lock. With fewer than ten users this costs nothing and removes every question about two operations overlapping.

## 3. Personal backup (web app)

### 3.1 Screen

A "Backup" item in the left bar opens a screen with:

- **Back up my data:** builds a backup and downloads it.
- **Restore from a backup:** choose a file, see a summary (date made, counts of notes, photos, fonts and styles, and anything that will be adjusted), then confirm by typing RESTORE, or cancel.
- **Safety backups:** the backups Jot took automatically before each restore. Each can be downloaded or deleted. Jot never deletes them itself.

### 3.2 What it contains

Everything the user owns: notes (title, content, tags, dates, whether each is in the trash, and whether each is read-only), every photo including unused ones, every font including archived ones with its files, and every style the user made. The five default styles are part of the system, not the user's data, so they are not in a personal backup. It does not contain the username, the password, or anything belonging to another user.

### 3.3 Format

One uncompressed tar file:

| Entry | Contents |
|---|---|
| `data.json` | Notes, tags, styles, and the photo and font records |
| `photos/<id>` | Each photo file |
| `fonts/<id>/<n>.woff2` | Each font file |
| `manifest.json` | Written last: format name and version, creation time, counts, the size and SHA-256 of every other entry, and a list of any missing files |

The manifest is last, so a download that was cut off has no manifest and is refused.

Format version 2 records whether each note is read-only (`jot-spec.md` §3). A version 1 backup (made before read-only notes) restores with every note writable.

### 3.4 Taking a backup

1. Read all of the user's records in a single database read transaction, so the backup is one moment in time.
2. Copy and hash every file those records point to. Files are written before their records and never change afterwards, so each one is complete.
3. A record whose file is missing does not stop the backup: the backup finishes, the missing file is listed in the manifest, and the user is told plainly which photo or font was already lost.
4. Build the archive on disk, check it by reading it back against its manifest, then stream it to the browser. It is never held in memory.

### 3.5 Restoring

Restore **replaces**: afterwards the account holds what the backup holds. That includes read-only notes: every note the account has now, read-only ones included, is replaced (the safety backup keeps them), and every note comes back exactly as it was in the backup, read-only or not. A read-only note is never in the trash, so a backup with one there is refused.

Default styles: a restore never touches the account's five default styles. They stay as they are (moved onto the restored copy of their font), and every other style is replaced by the backup's. Any default styles a backup holds are skipped: newer backups hold none, and backups made before default styles existed hold the old starter styles as ordinary styles, recognised by a default style's name together with being created with the account (the same moment as the backup's starter fonts). A style the user made, even one called "Body", is restored as an ordinary style. A backup must contain the five default fonts, which the default styles use. So after any restore the account has exactly one set of the five default styles.

1. **Upload** to a staging folder. Nothing live is touched. An upload that is not confirmed is deleted when cancelled, after 24 hours, or at the next server start.
2. **Check everything.** The restore is refused, with the reason shown, unless:
   - the manifest is present, the format is known and not newer than this Jot, and every entry matches its size and SHA-256, with none extra or duplicated, and none missing apart from files the manifest itself lists as missing;
   - entry names follow the patterns in 3.3 exactly, and every entry is a plain file;
   - every photo is a real JPEG, PNG, GIF or WebP, and every font file a real woff2;
   - tags and styles obey Jot's rules, and every photo and font that a note or style uses is in the backup or is listed in the manifest as missing.

   A file the manifest lists as missing is restored as it was backed up: its record comes back without a file, and the summary names it.

   Note content goes through the same sanitiser as normal saving. Content it would change is restored in cleaned form, and the summary says how many notes will be adjusted.
3. **Confirm.** The user types RESTORE. From here until the end, that user's saves and uploads are refused with a "restore in progress" message. Other users are unaffected.
4. **Safety backup.** A personal backup of the current data is taken (3.4) and kept on the server.
5. **Write the new files.** Every note, photo, font, style and tag in the backup is given a new identifier, and references between them (a photo inside a note, a style's font) are updated to match. First the list of new file names is saved in the database. Then the new photo and font files are written under those names and forced to disk, along with their folders. A crash here leaves nothing behind (step 7).
6. **Switch.** In one database transaction: delete the user's current notes, tags, styles, photo records and font records; insert the backup's; rebuild the user's search index; clear the list of new file names from step 5, since those files are now live; and record the list of old files that are no longer needed.
7. **Tidy up.** Delete the old files and the staging folder. At every server start, Jot finishes any tidy-up that was interrupted: files still on the step 5 list belong to a restore that never committed and are removed, and files on the old-files list belong to a restore that did commit and are removed.

What this gives:

- **A crash at any point** leaves either the old data complete (before the switch) or the new data complete (after it).
- **A tab left open from before the restore** cannot damage anything: the notes it knew have new identifiers, so its saves are refused and its unsaved text stays on screen for the user to copy. The tab that ran the restore reloads.
- **A backup can be restored into any account,** including on another Jot installation, because identifiers are always new.

The cost: links and bookmarks to individual notes stop working after a restore, because every note gets a new address.

## 4. Full system backup (CLI)

### 4.1 Commands

| Command | Does | App |
|---|---|---|
| `jot backup` | Writes a full backup to `data/backups/`, or to another folder with `--out`, and prints its name and SHA-256 | Running or stopped |
| `jot verify <file>` | Checks a backup completely without changing anything | Running or stopped |
| `jot restore <file>` | Rebuilds the system from a backup into an empty data folder | **Stopped** |

### 4.2 Taking a backup

1. `VACUUM INTO` writes one consistent, complete copy of the database, including recent saves not yet merged into the main file, without blocking users.
2. Sessions are removed from the copy, and it must pass SQLite's integrity check.
3. The files to include are listed **from that copy**, then copied and hashed. A missing file does not stop the backup: it is listed in the manifest and printed as a warning.
4. The result is an uncompressed tar: `jot.db`, `users/…`, then `manifest.json` last, with a `.sha256` file beside it. Both are forced to disk and readable only by their owner, because the backup contains password hashes.
5. The backup is checked with `jot verify` before the command reports success.

A backup left in `data/backups/` is on the same disk as the data. The command says so each time; `--out` writes to another disk.

### 4.3 Restoring

The owner stops the app, moves the old `data` folder aside, creates an empty one, and runs `jot restore <file>`.

1. Refuse unless the app is stopped and the data folder is empty (a `backups` folder is allowed).
2. Check the backup as `jot verify` does: checksums, exact entry set, entry names matching the fixed patterns, plain files only, a format and database version not newer than this Jot, and the database passing its integrity check.
3. Extract the database and files into the data folder, force them to disk, and confirm every record's file is present, apart from files the manifest lists as missing.
4. Print a summary. The app updates an older database to the current version when it next starts.

If the restore fails, it removes what it extracted, never the `backups` folder, and the command can be re-run. If it is killed outright it cannot clean up after itself: the owner empties the data folder again, keeping `backups`, and re-runs. Either way the old data is untouched in the folder the owner moved aside, and stays there until the owner deletes it.

Everyone signs in again afterwards. A system backup is the owner's own file and is trusted like the data folder itself; `jot restore` checks it for damage, not for deliberate tampering.

## 5. Fixes to existing behaviour

| Problem today | Fix |
|---|---|
| `jot-spec.md` says a backup is a copy of `data`. Copying while Jot runs can miss recent saves or give a corrupt copy. | `jot backup` is the supported backup. A folder copy is safe only with the app stopped. |
| Uploaded photos and downloaded fonts are not forced to disk before their record is saved, so a power cut can leave a record pointing at a missing or empty file. | Force each file and its folder to disk before saving its record. |
| An edit whose save fails is kept only in memory, and is lost if the tab closes. | Keep unsaved edits in the browser until the server confirms them, retry automatically, and show a clear "not saved" warning. Stored edits are kept per user and cleared at logout. |

## 6. Security

- Backup and restore routes require login and act only on the logged-in user's data.
- Requests that change data must come from Jot's own pages (matching `Origin`), and the restore upload is a raw file stream, not an HTML form.
- Archives are never unpacked with a generic tool: only the fixed entry names are accepted, and each file is created fresh in staging.
- Restored note content goes through the sanitiser, so a crafted personal backup cannot inject scripts.

## 7. Tests (all nine existing test types still apply)

- **Round trip, personal:** back up; change and delete data; restore; every note, tag, style, photo and font matches the original in content, and search returns the same results.
- **Round trip, system:** three users; back up; restore into an empty folder; every table except sessions and every file hash are identical.
- **Recent saves:** data saved a moment before a backup is in it, for both kinds.
- **Backup while writing:** saves and uploads run continuously during backups, many times; every backup verifies and every record has its file.
- **Crash at every step of a personal restore:** afterwards the account is exactly the old data or exactly the new data, and no stray files remain after the next start.
- **Failed system restore:** a restore that fails removes what it extracted, leaves the `backups` folder alone, and succeeds when re-run; after one killed part-way, emptying the folder and re-running succeeds.
- **Bad backups are refused and change nothing:** a flipped byte, a truncated file, a missing, extra or duplicated entry, a wrong checksum, a newer version, an entry name that tries to leave the staging folder, a link entry, a note using a photo that is not in the backup.
- **Unclean content:** a backup containing script in a note is restored with the script removed, and the count is reported.
- **Missing file:** a record whose file is gone does not block a backup, and is listed; that backup restores, for both kinds, with the missing file named.
- **Tidy-up after a committed restore:** restarting the server after a successful personal restore removes none of the restored files.
- **Lock after a crash:** a backup or restore killed part-way does not block the next one.
- **Safety backup:** restoring the safety backup brings back the pre-restore data.
- **Old tab:** a tab opened before a restore cannot change restored notes, and keeps its unsaved text.
- **Isolation:** a user cannot see, download or restore another user's backups.
- **One at a time:** a second backup or restore waits or is refused while one is running.
- **Large files:** a multi-gigabyte photo round-trips with bounded server memory.
- **Guards:** `jot restore` refuses while the app is running, and refuses a data folder that is not empty.
- **Unsaved edits:** an edit survives a failed save and a tab reload; one user's unsaved text is never shown to another.
- **End to end (browser):** a user backs up, deletes notes, restores, and sees them back; a second user is unaffected.

## 8. Out of scope

- An admin role, and any backup or restore of other users' data from the web app.
- Scheduled or automatic backups. **Owner's decision (2026-11-18):** backups are manual. Changes made after the most recent backup are not protected if the disk fails; running `jot backup` regularly and keeping a copy on another disk is the owner's responsibility.
- Encryption of backup files.
- Merging a backup into existing data.
- Restoring a full system backup over existing data in place.
