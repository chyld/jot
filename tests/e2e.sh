#!/usr/bin/env bash
# Type 8: end-to-end browser tests (Playwright) against the real Jot container.
# The app runs from the production image with its own throwaway ./.test-data/e2e
# bind mount; three users are created with the real CLI.  Extra args go to Playwright.
set -uo pipefail
cd "$(dirname "$0")/.."

export JOT_DATA_PATH=./.test-data/e2e
export E2E_PASSWORD='e2e password 1'
DC=(docker compose -p jot-e2e -f docker-compose.yml -f docker-compose.e2e.yml)

cleanup() { "${DC[@]}" down --remove-orphans >/dev/null 2>&1; }
trap cleanup EXIT

rm -rf ./.test-data/e2e ./e2e/test-results
mkdir -p ./.test-data/e2e ./e2e/test-results

echo "--> building and starting the app container"
"${DC[@]}" build app e2e >/dev/null || exit 1
"${DC[@]}" up -d --wait app >/dev/null || { "${DC[@]}" logs app; exit 1; }

echo "--> creating users with the CLI"
for u in alice bob carol; do
  printf '%s\n' "$E2E_PASSWORD" | "${DC[@]}" exec -T app jot create-user "$u" || exit 1
done

echo "--> running Playwright"
"${DC[@]}" run --rm -T e2e npx playwright test "$@"
status=$?
[ $status -ne 0 ] && "${DC[@]}" logs --tail 80 app
exit $status
