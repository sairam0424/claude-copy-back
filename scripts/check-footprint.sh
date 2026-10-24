#!/usr/bin/env bash
# Footprint gate: a release check that the access report `claude plugin validate`
# prints for this plugin is complete, short, and says what the mod does.
#
# Usage: bash scripts/check-footprint.sh [plugin-dir]   (default: this repo)
#        CB_CLAUDE="<engine command>" bash scripts/check-footprint.sh   (another engine)
#
# CB_CLAUDE is the command that runs the engine, default `claude`; it may carry
# a prefix such as `env HOME=/some/home /path/to/claude` to run a cached build.
#
# The catalogue publisher holds any release whose report is cut: the validator
# keeps the first 980 characters of a `calls` or `hooks` line and marks the cut
# `[+N chars]`. Engine calls therefore go through the small wrappers in
# hooks/api.ts. Checks:
#   1. neither the text nor the --json report holds a `[+N chars]` marker;
#   2. the `register.tsx calls` and `register.tsx hooks` lines are at most
#      MAX_LINE characters each (a cushion under the cap; lengths are printed);
#   3. the APIs the report lists are exactly EXPECTED_APIS: a new one must be
#      added here on purpose, and to the README's data handling text;
#   4. the report lists no gating hook, no state read or write, and says the
#      command hook answers its own command;
#   5. no `$.<ns>.<fn>(` engine call (any namespace, with or without a `<T>`
#      type-argument list) appears in hooks/ or src/ outside hooks/api.ts and
#      hooks/register.tsx. A comment must not spell one.
#   6. the source guard (scripts/check-sources.mjs) finds no console, process,
#      globalThis, fetch, timer, eval, require, reflection or non-relative
#      import in hooks/ or src/core/, and the files the hooks load stay inside
#      those two folders. The access report cannot see any of these.
# Prints the engine version. Exit 0 with one summary line when all pass, 1 on
# any failure, 2 on misuse.
set -euo pipefail

MAX_LINE=850
MARKER='\[\+[0-9]+ chars\]'
CALL='\$\.[a-z]+\.[a-zA-Z]+(<[^(]*>)?\('
EXPECTED_APIS='$.command.register $.process.run $.session.messages $.ui.copy $.ui.toast'
USAGE="usage: bash scripts/check-footprint.sh [plugin-dir]"

die() {
  printf 'check-footprint: %s\n%s\n' "$1" "$USAGE" >&2
  exit 2
}
case "${1:-}" in -h | --help) echo "$USAGE" && exit 0 ;; esac
[ "$#" -le 1 ] || die "too many arguments"
IFS=' ' read -r -a engine <<<"${CB_CLAUDE:-claude}"
command -v "${engine[0]}" >/dev/null 2>&1 || die "the engine command is not on PATH: ${engine[0]}"
dir="$(cd "${1:-$(dirname "${BASH_SOURCE[0]}")/..}" 2>/dev/null && pwd)" ||
  die "no such directory: ${1:-}"
cd "$dir"

failed=0
fail() {
  echo "check-footprint: FAIL: $*" >&2
  failed=1
}

echo "check-footprint: engine $("${engine[@]}" --version 2>&1 | head -n 1)"

# 1. No truncation marker in either report. The reports are held in variables,
# not files, so the script leaves nothing behind.
no_marker() {
  if printf '%s\n' "$2" | grep -Eq "$MARKER"; then
    fail "the $1 report is truncated:"
    printf '%s\n' "$2" | grep -Eo ".{0,60}$MARKER" | head -n 3 >&2 || true
  fi
}
text="$("${engine[@]}" plugin validate "$dir" 2>&1)" || fail "validate (text) exited non-zero"
json="$("${engine[@]}" plugin validate "$dir" --json 2>&1)" || fail "validate (--json) exited non-zero"
no_marker text "$text"
no_marker json "$json"

# 2. The calls and hooks lines: the text after `calls: ` and `hooks: `. Absent
# is a fail, so a changed report format cannot read as a pass.
line_length() {
  local name="$1" line body
  line="$(printf '%s\n' "$text" | grep -E "register\\.tsx $name: " | head -n 1 || true)"
  body="${line#*"$name": }"
  if [ -z "$line" ]; then
    fail "no 'register.tsx $name' line in the validate report"
    return 0
  fi
  echo "check-footprint: register.tsx $name line: ${#body} characters (limit $MAX_LINE)"
  [ "${#body}" -le "$MAX_LINE" ] || fail "the $name line is ${#body} characters, over $MAX_LINE"
}
line_length calls
line_length hooks

# 3. The API set, exactly. Each name is `$.noun.fn`, labels (via ...) dropped.
calls_line="$(printf '%s\n' "$text" | grep -E 'register\.tsx calls: ' | head -n 1 || true)"
listed="$(printf '%s\n' "$calls_line" | grep -Eo '\$\.[a-z]+\.[a-zA-Z]+' | sort -u | tr '\n' ' ' | sed 's/ $//')"
expected="$(printf '%s\n' "$EXPECTED_APIS" | tr ' ' '\n' | sort -u | tr '\n' ' ' | sed 's/ $//')"
if [ "$listed" != "$expected" ]; then
  fail "the report lists different APIs than the gate expects"
  printf '  listed:   %s\n  expected: %s\n' "$listed" "$expected" >&2
fi

# 4. What the hook list must and must not say.
if printf '%s\n' "$text" | grep -Eq 'gating hook'; then
  fail "the report lists a gating hook; /cc answers its own command and gates nothing:"
  printf '%s\n' "$text" | grep -E 'gating hook' >&2 || true
fi
printf '%s\n' "$text" | grep -Eq 'register\.tsx answers its own command: command\.run\{command=cc\}' ||
  fail "the report does not say the cc command hook answers its own command"
if printf '%s\n' "$text" | grep -Eq 'register\.tsx state (reads|writes)'; then
  fail "the report lists a state read or write; /cc keeps no state"
fi

# 5. Engine calls only in api.ts and register.tsx. grep exits 1 for no match
# (fine) and 2 on an error (a fail).
status=0
found="$(grep -rnE "$CALL" hooks src)" || status=$?
[ "$status" -le 1 ] || fail "the engine-call scan could not run (grep exit $status)"
offenders="$(printf '%s\n' "$found" | grep -vE '^hooks/(api\.ts|register\.tsx):' || true)"
if [ -n "$offenders" ]; then
  fail "engine calls outside hooks/api.ts and hooks/register.tsx (add a wrapper to api.ts):"
  printf '%s\n' "$offenders" >&2
fi

# 6. The source guard. It prints file:line, rule and token, never source text.
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
command -v node >/dev/null 2>&1 || fail "node is not on PATH; the source guard cannot run"
if guard_out="$(node "$here/check-sources.mjs" "$dir" 2>&1)"; then
  echo "$guard_out"
else
  fail "the source guard found something:"
  printf '%s\n' "$guard_out" >&2
fi

[ "$failed" -eq 0 ] || exit 1
echo "check-footprint: OK: reports complete, 5 APIs as expected, no gating hook, engine calls only in api.ts and register.tsx, source guard clean"
