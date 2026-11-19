# Jot

A private, multi-user note-taking web app with a rich-text editor (Tiptap), per-user
Google Fonts and named text styles. See `jot-spec.md` for the specification and
`DECISIONS.md` for choices made where the spec is silent.

## Run

```sh
docker compose up -d --build        # serves http://localhost:9003
```

All state lives in `./data` (bind-mounted, owned by your user):

```
data/
  jot.db               SQLite database (with the FTS5 search index)
  .lock                the backup/restore lock (empty)
  backups/             full backups written by `jot backup`
  users/<user id>/
    photos/            uploaded photos
    fonts/             downloaded Google Fonts files
    safety-backups/    taken automatically before each personal restore
  staging/             uploads and downloads in progress (cleared at start)
```

## Settings

Settings are optional and go in a `.env` file next to `docker-compose.yml`. Copy the
example and edit it, then start Jot:

```sh
cp .env.example .env
docker compose up -d
```

| Setting | Default | What it does |
|---|---|---|
| `JOT_PUBLIC_URL` | `http://localhost:9003` | The address shown to bots on the Account page, without `/mcp`. Set it to your public HTTPS address. It only changes what is displayed. |
| `JOT_UID`, `JOT_GID` | `1000`, `1000` | The user and group the app runs as, so files in `./data` belong to you. Change them if `id -u` and `id -g` are not 1000. |
| `JOT_SECURE_COOKIES` | off | Set to `1` when the web app itself is reached over HTTPS. The login cookie is then sent over HTTPS only, so logging in over plain HTTP stops working. |

`.env` is ignored by git.

## Deploying on a server

1. Clone the repository, copy `.env.example` to `.env` and set `JOT_PUBLIC_URL`.
2. `docker compose up -d --build`
3. Create the first account: `docker compose exec app jot create-user <name>`. A new
   deployment has no accounts and no notes, because `data` is not in the repository. To
   bring an existing system across instead, see "Backup and restore" below.

Jot serves plain HTTP. Before putting a server on the internet:

- **Port 9003 is published on every network interface.** Block it with the server's
  firewall, or change the port line in `docker-compose.yml` to `127.0.0.1:9003:9003`, so
  the app can only be reached through your HTTPS proxy on the same machine.
- **The login page does not limit password guesses.** Keep it off the internet by
  forwarding only `/mcp` (see "Bots"), or use strong passwords.
- **Backups are manual.** Run `jot backup --out` to another disk regularly.

## Backup and restore

Each user can back up and restore their own data on the **Account** page in the web
app. For the whole system, use the CLI (see `backup-spec.md`):

```sh
docker compose exec app jot backup                  # writes data/backups/jot-backup-<date>.tar (+ .sha256)
docker compose exec app jot backup --out /elsewhere # a folder on another disk (mount it into the container)
docker compose exec app jot verify /data/backups/jot-backup-<date>.tar
```

`jot backup` is the supported backup. Copying `data` is only safe with the app stopped:
while Jot runs, a plain copy can miss recent saves or be corrupt. A backup left in
`data/backups` is on the same disk as the data, so copy it somewhere else too. Backups
contain password hashes: keep them private.

To rebuild the whole system from a backup (everyone signs in again afterwards):

```sh
docker compose stop app
mv data data-old && mkdir -p data/backups          # the old data stays untouched in data-old
cp data-old/backups/jot-backup-<date>.tar data/backups/
docker compose run --rm app jot restore /data/backups/jot-backup-<date>.tar
docker compose up -d
```

`jot restore` refuses while Jot is running and refuses a data folder that is not empty
(a `backups` folder is allowed). If it fails it removes what it extracted and can be
re-run; if it is killed, empty the data folder again (keeping `backups`) and re-run.

## Bots (agent notes)

AI assistants with an MCP client can write notes into a user's **Inbox** and read that
user's notes (see `agent-spec.md`). Each user makes one token per bot on the **Account**
page (Bots), which also shows the address and a setup snippet:

- MCP server: `<JOT_PUBLIC_URL>/mcp`, Streamable HTTP, stateless
- Header: `Authorization: Bearer <token>`
- Tools: `create_note`, `list_notes`, `read_note` (bots cannot change or delete notes)

`JOT_PUBLIC_URL` (default `http://localhost:9003`) is the address shown to bots; set it
in `.env` (see "Settings"). The default only works for a bot on the same machine as Jot.

Jot itself serves plain HTTP on port 9003. Bots in the cloud need an HTTPS address that you
put in front of Jot (a reverse proxy or tunnel). That front must:

1. provide HTTPS;
2. pass requests and the `Authorization` header through to Jot unchanged;
3. allow request bodies up to 50 MB, which is what Jot accepts at `/mcp` (many proxies
   stop at 1 MB by default, which blocks notes with images);
4. ideally forward only `/mcp`, so the login page and notes stay reachable from your home
   network only.

Tokens are stored readable in the database (so the Account page can show them again):
anyone with the database or a full system backup can read them. They are never written to
the log and are not in personal backups.

## Users (CLI only)

```sh
docker compose exec app jot create-user alice     # asks for a password
docker compose exec app jot set-password alice    # also ends alice's sessions
docker compose exec app jot list-users
```

Passwords can also be piped: `printf 'secret pw\n' | docker compose exec -T app jot create-user alice`.

## Tests

Everything runs in Docker:

```sh
./test.sh                    # all nine test types, with a summary
./test.sh unit api           # only some
```

| # | Type | Where |
|---|---|---|
| 1 | Per-user isolation | `tests/isolation` |
| 2 | API integration (real SQLite) | `tests/api` |
| 3 | Unit | `tests/unit` |
| 4 | Security | `tests/security` |
| 5 | CLI | `tests/cli` |
| 6 | Database | `tests/db` |
| 7 | Frontend component | `tests/component` |
| 8 | End-to-end browser (Playwright vs the real container) | `e2e/specs`, `tests/e2e.sh` |
| 9 | Docker Compose smoke | `tests/smoke.sh` |

## Layout

```
src/server   Fastify API, SQLite, sessions, photos, fonts, styles
src/server/backup   personal and full system backup and restore
src/cli      the jot CLI (reuses the server code)
src/client   React + Vite frontend, Tiptap editor (src/client/editor)
src/shared   palette, tag and style rules shared by server and browser
assets       starter fonts (SIL OFL)
```
