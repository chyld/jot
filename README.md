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

The container runs as `1000:1000` by default; if your user differs, run with
`JOT_UID=$(id -u) JOT_GID=$(id -g)`.

## Backup and restore

Each user can back up and restore their own data on the **Backup** screen in the web
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
