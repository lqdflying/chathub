#!/usr/bin/env bash
# Type-check using classic tsc, filtering out pre-existing Drizzle ORM errors
# caused by duplicate drizzle-orm packages (.bun/ vs .pnpm/ resolution), then
# comparing the remaining diagnostics against a checked-in baseline of
# pre-existing errors (file + error-code pairs; line numbers and message text
# are unstable — TS2589 relocates, union orderings vary).
#
# Exit-status discipline (V2): a crashed compiler must never read as a pass.
# tsc exits 0 (clean), 1 (diagnostics, outputs emitted) or 2 (diagnostics with
# --noEmit). Any other status — 134 SIGABRT from a V8 heap OOM, 137 SIGKILL,
# etc. — or a 1/2 exit without any "error TS" line means the compiler did not
# complete normally: fail loudly instead of grepping an empty output.
set -o pipefail
export LC_ALL=C

# tsc must resolve before running. Without this guard a missing tsc would
# false-pass below. `bun run type-check` prepends node_modules/.bin to PATH;
# direct bash invocation does not.
if ! command -v tsc >/dev/null 2>&1; then
  echo "error: tsc not found on PATH." >&2
  echo "Run via 'bun run type-check' (bun prepends node_modules/.bin), or prefix:" >&2
  echo "  PATH=\"\$PWD/node_modules/.bin:\$PATH\" bash scripts/type-check-tsc.sh" >&2
  exit 1
fi

# The project graph exhausts the default V8 heap (~2GB) before completing; a
# heap crash used to false-pass here. 4GB completes on this repo. Callers may
# override (e.g. NODE_OPTIONS=--max-old-space-size=6144 on larger checkouts).
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}"

KNOWN_DRIZZLE_FILES=(
  "packages/database/src/schemas/agent.ts"
  "packages/database/src/schemas/apiKey.ts"
  "packages/database/src/schemas/chatGroup.ts"
  "packages/database/src/schemas/document.ts"
  "packages/database/src/schemas/file.ts"
  "packages/database/src/schemas/generation.ts"
  "packages/database/src/schemas/message.ts"
  "packages/database/src/schemas/oidc.ts"
  "packages/database/src/schemas/session.ts"
  "src/libs/oidc-provider/adapter.ts"
  "src/server/routers/lambda/chunk.ts"
  "src/server/routers/lambda/image.ts"
  "src/server/services/nextAuthUser/index.ts"
)

# Build grep -v pattern from known files
FILTER_PATTERN=$(printf "|^%s" "${KNOWN_DRIZZLE_FILES[@]}")
FILTER_PATTERN="${FILTER_PATTERN:1}"  # remove leading |

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# Overridable for the wrapper self-test (scripts/type-check-tsc.test.sh).
BASELINE_FILE="${TSC_BASELINE_FILE:-$SCRIPT_DIR/type-check-tsc.baseline.txt}"

# Run tsc and capture output AND its real exit status (no `|| true` — V2).
TSC_OUTPUT=$(tsc --project tsconfig.typecheck-tsc.json --noEmit --ignoreDeprecations 5.0 --pretty false 2>&1)
TSC_STATUS=$?

if [ "$TSC_STATUS" -eq 0 ]; then
  if [ "${1:-}" = "--write-baseline" ]; then
    : > "$BASELINE_FILE"
    echo "Wrote 0 baselined diagnostics to $BASELINE_FILE"
  fi
  echo "Type check passed."
  exit 0
fi

# Crash / signal / non-diagnostic failure: never a pass.
if [ "$TSC_STATUS" -gt 2 ]; then
  echo "error: tsc exited $TSC_STATUS (crash or signal — e.g. V8 heap OOM), not a diagnostic result." >&2
  printf '%s\n' "$TSC_OUTPUT" | tail -20 >&2
  exit 1
fi

ERROR_LINES=$(printf '%s\n' "$TSC_OUTPUT" | grep "error TS" || true)
if [ -z "$ERROR_LINES" ]; then
  echo "error: tsc exited $TSC_STATUS without any 'error TS' diagnostics (unexpected compiler failure)." >&2
  printf '%s\n' "$TSC_OUTPUT" | tail -20 >&2
  exit 1
fi

# Filter known Drizzle error lines
FILTERED=$(printf '%s\n' "$ERROR_LINES" | grep -v -E "$FILTER_PATTERN" || true)

# Normalize to stable "file<TAB>TSCODE" pairs (line/col/message are unstable).
# Paths may contain parentheses (Next.js route groups like `(main)`), so split
# at the FIRST `): error TS…:` marker and strip the trailing `(line,col)` from
# the head — never at the first `(`.
if [ -n "$FILTERED" ]; then
  CURRENT_PAIRS=$(printf '%s\n' "$FILTERED" | awk '
    match($0, /\): error TS[0-9]+:/) {
      head = substr($0, 1, RSTART - 1)
      code = substr($0, RSTART + 9, RLENGTH - 10)
      sub(/\([0-9]+,[0-9]+$/, "", head)
      print head "\t" code
    }
  ' | sort)
  # Diagnostics WITHOUT a file location (e.g. `error TS5058: The specified
  # path does not exist ...`) never match the pair pattern above. They must
  # fail loudly — dropping them here would turn a real diagnostic exit into a
  # false pass (and an empty --write-baseline).
  UNPARSED=$(printf '%s\n' "$FILTERED" | grep -v -E '\): error TS[0-9]+:' || true)
else
  CURRENT_PAIRS=""
  UNPARSED=""
fi

if [ -n "$UNPARSED" ]; then
  echo "error: tsc reported diagnostics without a file location; refusing to baseline or pass:" >&2
  printf '%s\n' "$UNPARSED" >&2
  exit 1
fi

if [ "${1:-}" = "--write-baseline" ]; then
  printf '%s\n' "$CURRENT_PAIRS" | grep -v '^$' > "$BASELINE_FILE" || true
  echo "Wrote $(grep -c . "$BASELINE_FILE" || true) baselined diagnostics to $BASELINE_FILE"
  exit 0
fi

if [ ! -f "$BASELINE_FILE" ]; then
  echo "error: baseline file missing: $BASELINE_FILE" >&2
  echo "Review every current diagnostic, then regenerate with:" >&2
  echo "  bash scripts/type-check-tsc.sh --write-baseline" >&2
  exit 1
fi

# Multiset comparison: a pair occurring more often than baselined is new.
NEW_PAIRS=$(comm -23 <(printf '%s\n' "$CURRENT_PAIRS" | grep -v '^$') <(sort "$BASELINE_FILE") || true)
RESOLVED_COUNT=$(comm -13 <(printf '%s\n' "$CURRENT_PAIRS" | grep -v '^$') <(sort "$BASELINE_FILE") | grep -c . || true)

if [ -n "$NEW_PAIRS" ]; then
  echo "Type errors found (new versus baseline, excluding known Drizzle ORM issues):"
  while IFS=$'\t' read -r file code; do
    [ -z "$file" ] && continue
    # Literal match: the line starts with "file(" and carries "error TSxxxx:".
    # (Paths may contain parentheses/brackets — never split at the first "(".)
    printf '%s\n' "$FILTERED" | awk -v f="$file" -v c="$code" '
      index($0, f "(") == 1 && index($0, "error " c ":") > 0 { print }
    ' | head -3
  done <<< "$NEW_PAIRS" | sort -u
  exit 1
fi

KNOWN_COUNT=$(printf '%s\n' "$ERROR_LINES" | grep -c -E "$FILTER_PATTERN" || true)
BASELINED_COUNT=$(printf '%s\n' "$CURRENT_PAIRS" | grep -c . || true)
echo "Type check passed. ($KNOWN_COUNT known Drizzle ORM errors filtered, $BASELINED_COUNT pre-existing baselined)"
if [ "$RESOLVED_COUNT" -gt 0 ]; then
  echo "note: $RESOLVED_COUNT baselined diagnostics no longer occur — consider regenerating: bash scripts/type-check-tsc.sh --write-baseline"
fi
exit 0
