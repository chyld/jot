#!/usr/bin/env bash
# Type 9: Docker Compose smoke test.
#  - the real docker-compose.yml starts the container and serves Jot on port 9003
#  - files written to the bind-mounted data folder belong to the host user
#  - everything in data (database, sessions, notes, photos, fonts) survives removing
#    the container and rebuilding the image from scratch
#  - jot backup / jot verify in the running container, jot restore's guards, and the
#    owner's full restore procedure (stop, move data aside, restore, start)
# It uses its own data folder (./.test-data/smoke) so your ./data is never touched.
# If your own Jot is running on 9003 it is stopped for the test and started again after.
set -uo pipefail
cd "$(dirname "$0")/.."

export JOT_DATA_PATH=./.test-data/smoke
DATA=./.test-data/smoke
JAR=./.test-data/smoke-cookies
EMPTY=./.test-data/smoke-empty
URL=http://localhost:9003
DC=(docker compose -p jot-smoke)
PASS='smoke password 1'

fail() { echo "SMOKE FAIL: $*"; exit 1; }
ok() { echo "  ok - $*"; }

restart_main=0
if [ -n "$(docker compose -p jot ps -q app 2>/dev/null)" ]; then
  echo "--> stopping your running Jot (project 'jot') to free port 9003; it is restarted afterwards"
  docker compose -p jot stop app >/dev/null
  restart_main=1
fi
cleanup() {
  "${DC[@]}" down --remove-orphans >/dev/null 2>&1
  rm -rf "$DATA" "$JAR" "$DATA-old" "$EMPTY"
  [ $restart_main = 1 ] && docker compose -p jot start app >/dev/null 2>&1
}
trap cleanup EXIT

rm -rf "$DATA" "$JAR" "$DATA-old" "$EMPTY"
mkdir -p "$DATA"

echo "--> docker compose up"
"${DC[@]}" up -d --build --wait app >/dev/null || { "${DC[@]}" logs app; fail "container did not become healthy"; }

curl -sf "$URL/api/health" | grep -q '"ok":true' || fail "health check on port 9003"
ok "container answers on port 9003"
curl -sf "$URL/" | grep -q '<div id="root">' || fail "frontend not served"
curl -sf "$URL/notes/whatever" | grep -q '<div id="root">' || fail "client-side routes not served"
ok "frontend served on port 9003"
[ "$(curl -s -o /dev/null -w '%{http_code}' "$URL/api/notes")" = 401 ] || fail "API not protected"
ok "API requires login"

[ "$("${DC[@]}" exec -T app id -u)" = "$(id -u)" ] || fail "container does not run as the host user"
ok "container runs as the host user ($(id -u))"

printf '%s\n' "$PASS" | "${DC[@]}" exec -T app jot create-user smoke >/dev/null || fail "CLI create-user"
"${DC[@]}" exec -T app jot list-users | grep -q '^smoke' || fail "CLI list-users"
ok "CLI creates and lists users"

code=$(curl -s -c "$JAR" -o /dev/null -w '%{http_code}' -H 'content-type: application/json' \
  --data "{\"username\":\"smoke\",\"password\":\"$PASS\"}" "$URL/api/login")
[ "$code" = 200 ] || fail "login ($code)"
note=$(curl -sf -b "$JAR" -H 'content-type: application/json' \
  --data '{"title":"Survivor","content":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"still here after a rebuild"}]}]}}' \
  "$URL/api/notes")
note_id=$(printf '%s' "$note" | grep -o '"id":"[A-Za-z0-9_-]*"' | head -1 | cut -d'"' -f4)
[ -n "$note_id" ] || fail "create note"
curl -sf -b "$JAR" -H 'content-type: application/json' --data '{"tag":"smoke"}' "$URL/api/notes/$note_id/tags" >/dev/null || fail "tag note"
base64 -d > "$DATA/../smoke.png" <<'EOF'
iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==
EOF
photo=$(curl -sf -b "$JAR" -F "file=@$DATA/../smoke.png;type=image/png" "$URL/api/photos")
rm -f "$DATA/../smoke.png"
photo_url=$(printf '%s' "$photo" | grep -o '"url":"[^"]*"' | cut -d'"' -f4)
[ -n "$photo_url" ] || fail "upload photo"
photo_sum=$(curl -sf -b "$JAR" "$URL$photo_url" | sha256sum | cut -d' ' -f1)
font_id=$(curl -sf -b "$JAR" "$URL/api/fonts" | grep -o '"id":"[A-Za-z0-9_-]*"' | head -1 | cut -d'"' -f4)
font_sum=$(curl -sf -b "$JAR" "$URL/api/fonts/$font_id/files/0.woff2" | sha256sum | cut -d' ' -f1)
ok "created a user, a tagged note, a photo; starter fonts present"

[ -f "$DATA/jot.db" ] || fail "no database in the data folder"
[ -n "$(find "$DATA/users" -path '*/photos/*' -type f)" ] || fail "no photo file in the data folder"
[ -n "$(find "$DATA/users" -path '*/fonts/*' -name '*.woff2')" ] || fail "no font files in the data folder"
bad_owner=$(find "$DATA" ! -user "$(id -u)" | head -1)
[ -z "$bad_owner" ] || fail "file not owned by the host user: $bad_owner"
ok "data folder holds jot.db, users/<id>/photos and users/<id>/fonts, all owned by $(id -un)"

echo "--> removing the container and rebuilding the image from scratch"
"${DC[@]}" down >/dev/null || fail "compose down"
"${DC[@]}" build --no-cache app >/dev/null 2>&1 || fail "rebuild"
"${DC[@]}" up -d --force-recreate --wait app >/dev/null || fail "container did not come back"

[ "$(curl -s -b "$JAR" -o /dev/null -w '%{http_code}' "$URL/api/me")" = 200 ] || fail "session did not survive the rebuild"
ok "existing session still valid"
curl -sf -b "$JAR" "$URL/api/notes/$note_id" | grep -q 'still here after a rebuild' || fail "note content lost"
curl -sf -b "$JAR" "$URL/api/notes/$note_id" | grep -q '"tags":\["smoke"\]' || fail "tag lost"
curl -sf -b "$JAR" "$URL/api/search?q=rebuild" | grep -q "$note_id" || fail "search index lost"
ok "note, tag and search index survived"
[ "$(curl -sf -b "$JAR" "$URL$photo_url" | sha256sum | cut -d' ' -f1)" = "$photo_sum" ] || fail "photo changed or lost"
ok "photo survived byte for byte"
[ "$(curl -sf -b "$JAR" "$URL/api/fonts/$font_id/files/0.woff2" | sha256sum | cut -d' ' -f1)" = "$font_sum" ] || fail "font file lost"
ok "font files survived"
code=$(curl -s -o /dev/null -w '%{http_code}' -H 'content-type: application/json' \
  --data "{\"username\":\"smoke\",\"password\":\"$PASS\"}" "$URL/api/login")
[ "$code" = 200 ] || fail "login after rebuild ($code)"
"${DC[@]}" exec -T app jot list-users | grep -q '^smoke' || fail "user lost"
ok "user can still log in"

echo "--> full system backup in the running container"
out=$("${DC[@]}" exec -T app jot backup) || fail "jot backup: $out"
name=$(printf '%s\n' "$out" | sed -n 's|^Backup written: /data/backups/||p')
[ -n "$name" ] && [ -f "$DATA/backups/$name" ] || fail "backup not written to data/backups: $out"
[ "$(stat -c %a "$DATA/backups/$name")" = 600 ] || fail "backup is readable by others"
[ "$(stat -c %u "$DATA/backups/$name")" = "$(id -u)" ] || fail "backup not owned by the host user"
(cd "$DATA/backups" && sha256sum -c --quiet "$name.sha256") || fail ".sha256 file does not match"
printf '%s\n' "$out" | grep -q "^SHA-256: $(cut -d' ' -f1 "$DATA/backups/$name.sha256")$" || fail "printed SHA-256 differs"
printf '%s\n' "$out" | grep -qi "same disk" || fail "no same-disk note"
"${DC[@]}" exec -T app jot verify "/data/backups/$name" | grep -q '^OK' || fail "jot verify"
ok "jot backup writes a verified, owner-only backup and its .sha256 ($name)"

echo "--> jot restore refuses while Jot runs"
err=$("${DC[@]}" exec -T app jot restore "/data/backups/$name" 2>&1) && fail "restore ran inside the running app"
printf '%s' "$err" | grep -qi "running" || fail "unexpected refusal: $err"
mkdir -p "$EMPTY/backups" && cp "$DATA/backups/$name" "$EMPTY/backups/"
err=$(JOT_DATA_PATH=$EMPTY "${DC[@]}" run --rm -T --no-deps app jot restore "/data/backups/$name" 2>&1) && fail "restore ran while the app was running"
printf '%s' "$err" | grep -qi "running" || fail "running app not detected from a run container: $err"
[ "$(ls -A "$EMPTY" | grep -v '^\.lock$' | tr '\n' ' ')" = "backups " ] || fail "refused restore changed the folder"
ok "refused from inside the app and from a separate run container"

echo "--> the owner's restore: stop, move data aside, restore into an empty folder, start"
"${DC[@]}" stop app >/dev/null || fail "stop"
mv "$DATA" "$DATA-old"
mkdir -p "$DATA/backups"
cp "$DATA-old/backups/$name" "$DATA-old/backups/$name.sha256" "$DATA/backups/"
touch "$DATA/notes.txt"
err=$("${DC[@]}" run --rm -T --no-deps app jot restore "/data/backups/$name" 2>&1) && fail "restore into a non-empty folder"
printf '%s' "$err" | grep -qi "not empty" || fail "unexpected refusal: $err"
rm "$DATA/notes.txt"
out=$("${DC[@]}" run --rm -T --no-deps app jot restore "/data/backups/$name" 2>&1) || fail "jot restore: $out"
printf '%s' "$out" | grep -q "1 user" || fail "restore summary: $out"
"${DC[@]}" up -d --wait app >/dev/null || fail "app did not start on the restored data"
[ "$(curl -s -b "$JAR" -o /dev/null -w '%{http_code}' "$URL/api/me")" = 401 ] || fail "old session survived a system restore"
code=$(curl -s -c "$JAR" -o /dev/null -w '%{http_code}' -H 'content-type: application/json' \
  --data "{\"username\":\"smoke\",\"password\":\"$PASS\"}" "$URL/api/login")
[ "$code" = 200 ] || fail "login after restore ($code)"
curl -sf -b "$JAR" "$URL/api/notes/$note_id" | grep -q 'still here after a rebuild' || fail "note lost in restore"
curl -sf -b "$JAR" "$URL/api/notes/$note_id" | grep -q '"tags":\["smoke"\]' || fail "tag lost in restore"
curl -sf -b "$JAR" "$URL/api/search?q=rebuild" | grep -q "$note_id" || fail "search index lost in restore"
[ "$(curl -sf -b "$JAR" "$URL$photo_url" | sha256sum | cut -d' ' -f1)" = "$photo_sum" ] || fail "photo changed in restore"
[ "$(curl -sf -b "$JAR" "$URL/api/fonts/$font_id/files/0.woff2" | sha256sum | cut -d' ' -f1)" = "$font_sum" ] || fail "font changed in restore"
[ -f "$DATA-old/jot.db" ] || fail "the old data folder was touched"
bad_owner=$(find "$DATA" ! -user "$(id -u)" | head -1)
[ -z "$bad_owner" ] || fail "restored file not owned by the host user: $bad_owner"
ok "restored system serves the same note, tag, search, photo and font; everyone signs in again"

echo "SMOKE PASS"
