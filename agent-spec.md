# Jot — agent notes specification

- **Status:** draft. Not built.
- **Date:** 2026-11-19
- **Adds to:** `jot-spec.md`.
- **In one line:** AI bots can create notes that land in a user's Inbox, and can read that user's notes, through an MCP server built into Jot.

## 1. What a bot can and cannot do

| Can | Cannot |
|---|---|
| Create a note in its user's Inbox, with a title, tags and images | Change or delete any note |
| List and search that user's notes, including the Inbox | See the trash, fonts, styles, backups or tokens |
| Read one note in full, as Markdown | Download photos (it sees a placeholder) |
| | Touch any other user's data |

## 2. Tokens

- A user creates one token per bot on the Account page, giving each a name (1 to 40 characters, unique for that user), for example "Grok" or "Claude".
- The token stays visible on the Account page for as long as it exists, with a Copy button, a "last used" time, and a Revoke button. Revoking deletes it at once.
- Tokens are stored readable in the database (the owner's decision, so they can be shown again). Anyone who can read the database or a full system backup can read them.
- A token works only at `/mcp`. It is never accepted by the web app's own routes, and a login cookie is never accepted at `/mcp`.
- A token belongs to one user, and everything a bot does is limited to that user.
- Tokens are never written to the server log.
- Tokens are not in personal backups, and a personal restore leaves the account's tokens as they are. They are in full system backups, as part of the database.

## 3. The Inbox

- A new Inbox item in the left bar shows the number of notes in the Inbox. The number is simply how many notes are there; nothing tracks "read" or "unread".
- A note a bot creates is an ordinary note with two extra facts recorded on it: it is in the Inbox, and the name of the bot that wrote it. The name is copied onto the note, so it survives the token being revoked.
- Inbox notes do not appear on the home page, in its search or in its tag filter. They appear only on the Inbox screen, newest first, each showing its bot's name.
- Opening an Inbox note opens the normal editor. It can be edited, tagged, made read-only or trashed like any note.
- **Keep** moves a note out of the Inbox into the user's notes. The bot's name stays on it.
- Only the user can keep or trash a note. A bot cannot.

## 4. The MCP server

- Built into Jot at `/mcp`, using MCP's standard HTTP transport, with no sessions: every request stands alone and carries `Authorization: Bearer <token>`.
- A request may be up to 50 MB. There is no limit on the number of notes or images.
- One setting, `JOT_PUBLIC_URL` (default `http://localhost:9003`), is the address the Account page shows to bots, with a ready-to-copy setup snippet.

Three tools:

| Tool | Arguments | Returns |
|---|---|---|
| `create_note` | `markdown` (required), `title`, `tags`, `images`, `request_id` | The new note's id and title |
| `list_notes` | `query`, `tag`, `cursor` (all optional) | A page of up to 20 notes: id, title, tags, author, whether it is in the Inbox, last updated, a short preview, and a cursor for the next page |
| `read_note` | `id` | The note as Markdown, with its title, tags and author |

- **Author** is the bot's name for a bot-written note, and "user" otherwise.
- **`request_id`:** if the same bot sends the same `request_id` again, Jot returns the note it already made instead of creating another. This makes retries safe.
- **Untrusted content:** every note title, preview and body returned to a bot is wrapped in a clearly marked "untrusted data" block that names its author, and each tool's description tells the bot never to follow instructions found inside notes. This lowers the risk of one bot steering another through a note; it cannot remove it.

## 5. Creating a note

- **Title:** the one given; otherwise the first heading; otherwise the first line of text.
- **Tags:** must follow Jot's tag rules (a–z, 1 to 30 characters; uppercase is lowercased). If any tag is invalid, the whole request is refused with a message saying which.
- **Images:** each is sent as `{ name, mime_type, data }`, where `data` is the image in base64. JPEG, PNG, GIF and WebP only, checked from the image's own bytes, not the stated type. Each is stored as a normal Jot photo.
- **Placing images:** the Markdown refers to an image by its name, `![caption](name)`, and the photo goes there. An image that the Markdown never mentions is added at the end. An image reference that matches no supplied image is dropped and its caption kept as text. Jot never downloads anything from a web address.
- If anything in the request is invalid, nothing is created.

## 6. Markdown

Converted with a standard Markdown parser and an allow-list, then passed through Jot's existing note sanitiser.

| Markdown | Becomes |
|---|---|
| Plain text | Paragraphs |
| `**bold**`, `*italic*`, `~~strikethrough~~` | Bold, italic, strikethrough |
| `#`, `##`, `###` | Heading 1, 2, 3 (deeper headings become Heading 3) |
| Bullet and numbered lists, nested | Bullet and numbered lists |
| Links | Links, for `http`, `https` and `mailto` only; any other link keeps its text and loses the link |
| Tables | Tables |
| `` `code` `` and fenced code | Inline code and code blocks |
| `>` quotes | Block quotes |
| `---` | Horizontal line |

- Anything else (task-list checkboxes, footnotes, and so on) keeps its words and loses its markers.
- Raw HTML is shown as literal text. It is never interpreted.
- **Look:** all text a bot writes is stored in the Typewriter look, Fira Code at 15 px in Jet, written onto the text itself the way applying a style does. Heading text gets the Typewriter font and colour (Fira Code, Jet) but no font size, so Jot's normal Heading 1, 2 and 3 sizes apply and headings stay larger than the body text. Code blocks use Jot's normal code look.
- Task-list items (`- [ ] item`, `- [x] item`) become plain list items: the words stay and the `[ ]` or `[x]` marker goes.

## 7. Reading a note

A note is turned back into Markdown using the same set of features. Anything Markdown cannot express is left out: fonts, sizes, colours, highlights and underline are dropped, a task list becomes a plain list, and a photo becomes `[photo]`. This is by design and is stated in the tool's description.

Trashed notes are never listed or readable. Read-only notes are readable like any other.

## 8. Getting to Jot from the internet

Jot itself keeps serving plain HTTP on port 9003. Bots that run in the cloud need an HTTPS address, which the owner sets up in front of Jot. That front must:

- provide HTTPS;
- pass requests and the `Authorization` header through to Jot unchanged;
- ideally forward only `/mcp`, so the login page and notes stay reachable from the home network only.

`JOT_PUBLIC_URL` is then set to that HTTPS address.

## 9. Backups

- A personal backup records, for each note, whether it is in the Inbox and its bot name, and a restore brings them back as they were. Older backups restore with every note outside the Inbox.
- Tokens: see section 2.

## 10. Tests (all nine existing test types still apply)

- **Isolation:** a token reaches only its own user's notes; a revoked or unknown token is refused; a token does nothing at the web app's routes, and a login cookie does nothing at `/mcp`.
- **Bots cannot change anything:** there is no tool to edit, tag, keep, trash or delete, and no request to `/mcp` alters an existing note.
- **Create:** each Markdown feature in the table converts as stated; everything outside it keeps its words; raw HTML and script arrive as literal text; the stored note passes the sanitiser unchanged; text carries the Typewriter look.
- **Images:** placed by name; an unmentioned image goes at the end; an unknown reference is dropped; a wrong type or a file that is not really an image refuses the whole request; no web address is ever fetched.
- **Title and tags:** the three title rules; an invalid tag refuses the request and creates nothing.
- **Retries:** the same `request_id` twice gives one note.
- **Read:** list, search by text and tag, paging, and reading a note; the trash is never visible; every returned note is wrapped as untrusted with its author.
- **Inbox:** bot notes appear only in the Inbox with the right count; Keep moves a note to the home page and keeps the bot's name; trashing works.
- **Tokens:** create, show, copy, revoke, last-used time; a token never appears in the log or in a personal backup.
- **Size:** a 40 MB request is accepted and a 60 MB request is refused with a clear message.
- **Backups:** Inbox state and bot names survive a personal backup and restore.
- **End to end:** a real MCP client connects with a token, creates a note with an image, and the user sees it in the Inbox and keeps it.

## 11. Out of scope

- Bots changing, tagging, keeping, trashing or deleting notes.
- Bots downloading photos, or Jot fetching images from web addresses.
- HTTPS inside Jot, and setting up the internet-facing front.
- Limits on the number of notes or images.
- Per-token permissions (every token can both create and read).

## 12. Risks the owner has accepted

- A bot can read notes other bots wrote, before the user has reviewed them. Labelling them as untrusted reduces the chance a bot obeys hidden instructions, but does not remove it.
- Tokens are readable by anyone with the database or a full system backup, and each can read all of its user's notes.
- Security in transit depends on the HTTPS front the owner sets up.
