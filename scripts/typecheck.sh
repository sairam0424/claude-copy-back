#!/usr/bin/env bash
# Best-effort type check of hooks/ and tests/kit/ (and, through their imports,
# the matcher core in src/core) against the engine's own claude-code.d.ts, with
# the compiler options the types file's header gives for a hooks module plus
# --erasableSyntaxOnly (no enums, namespaces or parameter properties: Node runs
# the same files by stripping types). `claude plugin test` does not type-check,
# so this is the one type gate.
#
# Usage: bash scripts/typecheck.sh
#        CB_TSC=/path/to/typescript/bin/tsc bash scripts/typecheck.sh
#        CB_DTS=/path/to/claude-code.d.ts bash scripts/typecheck.sh
#
# Nothing is installed or downloaded. The types file is the newest one the
# engine has written under /private/tmp/claude-*/bundled-skills/ (it is wiped by
# a reboot, and written again when the plugin-authoring skill loads). The
# compiler is CB_TSC, else a typescript already in the npx cache, else a tsc on
# PATH. With no types file or no compiler it says so and exits 0: it is a
# development aid, not a test gate. Exit 1 on a type error, 2 on misuse.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bundled_glob='/private/tmp/claude-*/bundled-skills/*/*/plugin-authoring/types/claude-code.d.ts'

dts="${CB_DTS:-}"
if [ -z "$dts" ]; then
  while IFS= read -r candidate; do
    if [ -z "$dts" ] || [ "$candidate" -nt "$dts" ]; then dts="$candidate"; fi
  done < <(compgen -G "$bundled_glob" || true)
fi
if [ -z "$dts" ] || [ ! -f "$dts" ]; then
  echo "typecheck: no claude-code.d.ts on this machine; nothing to check against."
  echo "typecheck: load the plugin-authoring skill in a Claude Code session, then run again."
  [ "${CB_TYPECHECK_REQUIRED:-0}" = "1" ] && exit 1
  echo "typecheck: (exit 0: a development aid unless CB_TYPECHECK_REQUIRED=1)"
  exit 0
fi

tsc="${CB_TSC:-}"
if [ -z "$tsc" ]; then
  tsc="$(compgen -G "$HOME/.npm/_npx/*/node_modules/typescript/bin/tsc" | head -n 1 || true)"
fi
if [ -z "$tsc" ] && command -v tsc >/dev/null 2>&1; then
  tsc="$(command -v tsc)"
fi
if [ -z "$tsc" ]; then
  echo "typecheck: no TypeScript compiler found (set CB_TSC to a tsc); nothing checked."
  [ "${CB_TYPECHECK_REQUIRED:-0}" = "1" ] && exit 1
  echo "typecheck: (exit 0: a development aid unless CB_TYPECHECK_REQUIRED=1)"
  exit 0
fi

echo "typecheck: types $dts"
echo "typecheck: $(head -n 1 "$dts")"
echo "typecheck: compiler $tsc"

cd "$root"
node "$tsc" --noEmit --target es2023 --lib es2023 --module esnext \
  --moduleResolution bundler --strict --noUncheckedIndexedAccess --skipLibCheck \
  --jsx react --jsxFactory h --jsxFragmentFactory Fragment \
  --allowImportingTsExtensions --erasableSyntaxOnly \
  "$dts" hooks/*.ts hooks/*.tsx tests/kit/*.ts tests/kit/*.tsx
echo "typecheck: OK"
