#!/usr/bin/env bash
# Runs Jot's test types inside Docker. Nothing is installed on the host.
#
#   ./test.sh                 all nine types
#   ./test.sh unit api        only the named types
#
# Types: isolation api unit security cli db component e2e smoke
set -uo pipefail
cd "$(dirname "$0")"

ALL=(isolation api unit security cli db component e2e smoke)
TYPES=("$@")
[ ${#TYPES[@]} -eq 0 ] && TYPES=("${ALL[@]}")

declare -A NUM=([isolation]=1 [api]=2 [unit]=3 [security]=4 [cli]=5 [db]=6 [component]=7 [e2e]=8 [smoke]=9)
declare -A RESULT

needs_runner=0
for t in "${TYPES[@]}"; do
  case "$t" in isolation|api|unit|security|cli|db|component) needs_runner=1 ;; esac
done

if [ "$needs_runner" = 1 ]; then
  echo "==> building test runner image"
  docker compose --profile test build test >/dev/null || { echo "test runner build failed"; exit 1; }
fi

for t in "${TYPES[@]}"; do
  echo
  echo "==> [${NUM[$t]:-?}] $t"
  case "$t" in
    isolation|api|unit|security|cli|db|component)
      docker compose --profile test run --rm -T test npm run --silent "test:$t"
      ;;
    e2e) ./tests/e2e.sh ;;
    smoke) ./tests/smoke.sh ;;
    *) echo "unknown test type: $t"; false ;;
  esac
  if [ $? -eq 0 ]; then RESULT[$t]=PASS; else RESULT[$t]=FAIL; fi
done

echo
echo "==> summary"
status=0
for t in "${TYPES[@]}"; do
  printf '  %s. %-10s %s\n' "${NUM[$t]:-?}" "$t" "${RESULT[$t]}"
  [ "${RESULT[$t]}" = PASS ] || status=1
done
exit $status
