#!/usr/bin/env bash
# Kit tests: runs every tests/kit/*.test.tsx against the plugin with the
# engine's own test runner and fails if any test fails, any file does not load,
# or nothing ran.
#
# Usage: bash scripts/kit-test.sh [plugin-dir]
#        CB_CLAUDE="<engine command>" bash scripts/kit-test.sh   (another engine)
#
# Why not `claude plugin test .`? That command runs EVERY *.test.ts and
# *.test.tsx under the folder, and tests/*.test.ts are node:test files for the
# matcher core, which the kit cannot load ("cannot import node:test"). The kit
# tests are *.test.tsx, which `node --test tests/` does not pick up, and this
# script runs them one file at a time with the engine's per-file mode
# (`claude plugin test --file <abs-path> <dir>`). That mode is undocumented and
# always exits 0, so the verdict is read from its report line with jq; the
# script exits 1 on any failure, 2 on misuse.
set -euo pipefail

USAGE="usage: bash scripts/kit-test.sh [plugin-dir]"
die() {
  printf 'kit-test: %s\n%s\n' "$1" "$USAGE" >&2
  exit 2
}
case "${1:-}" in -h | --help) echo "$USAGE" && exit 0 ;; esac
[ "$#" -le 1 ] || die "too many arguments"
IFS=' ' read -r -a engine <<<"${CB_CLAUDE:-claude}"
command -v "${engine[0]}" >/dev/null 2>&1 || die "the engine command is not on PATH: ${engine[0]}"
command -v jq >/dev/null 2>&1 || die "jq is not on PATH"
dir="$(cd "${1:-$(dirname "${BASH_SOURCE[0]}")/..}" 2>/dev/null && pwd)" ||
  die "no such directory: ${1:-}"
[ -d "$dir/tests/kit" ] || die "no tests/kit directory in $dir"

echo "kit-test: engine $("${engine[@]}" --version 2>&1 | head -n 1)"

total=0
failed=0
for file in "$dir"/tests/kit/*.test.tsx; do
  out="$("${engine[@]}" plugin test --file "$file" "$dir" 2>&1)" || true
  report="$(printf '%s\n' "$out" | grep '^claude-plugin-test-report ' | head -n 1 || true)"
  name="${file##*/}"
  if [ -z "$report" ]; then
    echo "kit-test: FAIL: $name: no report line" >&2
    printf '%s\n' "$out" | head -n 5 >&2
    failed=$((failed + 1))
    continue
  fi
  json="${report#claude-plugin-test-report }"
  count="$(printf '%s\n' "$json" | jq '.results | length')"
  bad="$(printf '%s\n' "$json" | jq '[.results[] | select(.failure != null)] | length')"
  err="$(printf '%s\n' "$json" | jq -r '.error // empty')"
  total=$((total + count))
  if [ -n "$err" ] || [ "$bad" -gt 0 ] || [ "$count" -eq 0 ]; then
    echo "kit-test: FAIL: $name: $count tests, $bad failed ${err:+(file error: $err)}" >&2
    printf '%s\n' "$json" | jq -r '.results[] | select(.failure != null) | "  - \(.title): \(.failure | split("\n")[0])"' >&2
    failed=$((failed + 1))
  else
    echo "kit-test: ok   $name: $count tests"
  fi
done

[ "$total" -gt 0 ] || { echo "kit-test: FAIL: no tests ran" >&2; exit 1; }
[ "$failed" -eq 0 ] || exit 1
echo "kit-test: OK: $total tests in all files passed"
