#!/usr/bin/env bash
# Self-test for scripts/type-check-tsc.sh wrapper semantics (V2).
# Uses a stub `tsc` on PATH so no real compile runs. Covers: clean pass,
# known-Drizzle-only diagnostics, baselined diagnostics, new diagnostics,
# fatal compiler exit (e.g. heap OOM), and a 1/2 exit with no diagnostics.
#
# Run: bash scripts/type-check-tsc.test.sh
set -u
export LC_ALL=C

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WRAPPER="$REPO_ROOT/scripts/type-check-tsc.sh"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/bin"
cat > "$TMP/bin/tsc" <<'STUB'
#!/usr/bin/env bash
# Stub compiler: prints $STUB_OUTPUT and exits $STUB_STATUS.
printf '%s\n' "${STUB_OUTPUT:-}"
exit "${STUB_STATUS:-0}"
STUB
chmod +x "$TMP/bin/tsc"

BASELINE="$TMP/baseline.txt"
FAILURES=0

run_wrapper() {
  # $1 = stub status, $2 = stub output
  cd "$REPO_ROOT" && env -i PATH="$TMP/bin:/usr/bin:/bin" HOME="$HOME" \
    TSC_BASELINE_FILE="$BASELINE" \
    STUB_STATUS="$1" STUB_OUTPUT="$2" \
    bash "$WRAPPER" 2>&1
}

check() {
  # $1 = name, $2 = expected exit, $3 = actual exit, $4 = output, $5 = expected substring
  if [ "$3" -ne "$2" ]; then
    echo "FAIL: $1 — expected exit $2, got $3"
    printf '%s\n' "$4" | tail -5
    FAILURES=$((FAILURES + 1))
  elif ! printf '%s\n' "$4" | grep -qF "$5"; then
    echo "FAIL: $1 — output missing '$5'"
    printf '%s\n' "$4" | tail -5
    FAILURES=$((FAILURES + 1))
  else
    echo "PASS: $1"
  fi
}

DRIZZLE_LINE='packages/database/src/schemas/agent.ts(10,5): error TS2322: drizzle noise'
NEW_LINE='src/app/page.ts(3,1): error TS2304: Cannot find name foo.'

# 1. Clean compile passes.
OUT=$(run_wrapper 0 ""); S=$?
check "clean pass" 0 "$S" "$OUT" "Type check passed."

# 2. Only known Drizzle diagnostics pass (filtered).
: > "$BASELINE"
OUT=$(run_wrapper 2 "$DRIZZLE_LINE"); S=$?
check "known-only diagnostics" 0 "$S" "$OUT" "known Drizzle ORM errors filtered"

# 3. Baselined diagnostics pass.
printf 'src/app/page.ts\tTS2304\n' > "$BASELINE"
OUT=$(run_wrapper 2 "$NEW_LINE"); S=$?
check "baselined diagnostics" 0 "$S" "$OUT" "pre-existing baselined"

# 4. New diagnostics fail and print the offending line.
: > "$BASELINE"
OUT=$(run_wrapper 2 "$NEW_LINE"); S=$?
check "new diagnostics fail" 1 "$S" "$OUT" "Cannot find name foo."

# 5. Fatal compiler exit (heap OOM style) fails loudly — never a pass.
: > "$BASELINE"
OOM_TEXT='FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory'
OUT=$(run_wrapper 134 "$OOM_TEXT"); S=$?
check "fatal exit 134 fails" 1 "$S" "$OUT" "exited 134"

# 6. Diagnostic-status exit without any error lines fails loudly.
: > "$BASELINE"
OUT=$(run_wrapper 2 "Some non-diagnostic compiler abort"); S=$?
check "status 2 without diagnostics fails" 1 "$S" "$OUT" "without any 'error TS' diagnostics"

# 7. --write-baseline records current pairs.
: > "$BASELINE"
cd "$REPO_ROOT" && env -i PATH="$TMP/bin:/usr/bin:/bin" HOME="$HOME" \
  TSC_BASELINE_FILE="$BASELINE" STUB_STATUS=2 STUB_OUTPUT="$NEW_LINE" \
  bash "$WRAPPER" --write-baseline >/dev/null 2>&1
if grep -qF $'src/app/page.ts\tTS2304' "$BASELINE"; then
  echo "PASS: --write-baseline records pairs"
else
  echo "FAIL: --write-baseline did not record pairs"
  FAILURES=$((FAILURES + 1))
fi

# 8. Parenthesized Next.js path: same file+code at a NEW line still passes
# (T3 — the parser must split at the `): error TS` marker, not the first "(").
PAREN_FILE='src/app/[variants]/(main)/settings/page.tsx'
printf '%s\tTS2304\n' "$PAREN_FILE" > "$BASELINE"
OUT=$(run_wrapper 2 "$PAREN_FILE(99,7): error TS2304: reworded message text."); S=$?
check "parenthesized path relocated/reworded passes" 0 "$S" "$OUT" "pre-existing baselined"

# 9. Parenthesized path with a genuinely new code fails and prints the line.
OUT=$(run_wrapper 2 "$PAREN_FILE(99,7): error TS9999: brand new breakage."); S=$?
check "parenthesized path new code fails" 1 "$S" "$OUT" "brand new breakage."

# 10. Multiset counts: pair baselined once but reported twice fails.
OUT=$(run_wrapper 2 "$PAREN_FILE(1,1): error TS2304: one.
$PAREN_FILE(2,2): error TS2304: two."); S=$?
check "duplicate count beyond baseline fails" 1 "$S" "$OUT" "TS2304"

# 11. Baseline generated through the wrapper normalizes parenthesized paths.
: > "$BASELINE"
cd "$REPO_ROOT" && env -i PATH="$TMP/bin:/usr/bin:/bin" HOME="$HOME" \
  TSC_BASELINE_FILE="$BASELINE" STUB_STATUS=2 \
  STUB_OUTPUT="$PAREN_FILE(3,1): error TS2304: Cannot find name foo." \
  bash "$WRAPPER" --write-baseline >/dev/null 2>&1
if grep -qF "$PAREN_FILE"$'\tTS2304' "$BASELINE"; then
  echo "PASS: --write-baseline normalizes parenthesized paths"
else
  echo "FAIL: --write-baseline kept a raw parenthesized diagnostic"
  cat "$BASELINE"
  FAILURES=$((FAILURES + 1))
fi

# 12. U1: a non-file diagnostic (no `file(line,col)` prefix) must fail loudly,
# not vanish from the pair set into a false pass.
: > "$BASELINE"
GLOBAL_LINE="error TS5058: The specified path does not exist: 'missing'."
OUT=$(run_wrapper 1 "$GLOBAL_LINE"); S=$?
check "non-file diagnostic fails" 1 "$S" "$OUT" "TS5058"

# 13. U1: a non-file diagnostic mixed with a baselined file diagnostic fails.
printf 'src/app/page.ts\tTS2304\n' > "$BASELINE"
OUT=$(run_wrapper 1 "$NEW_LINE
$GLOBAL_LINE"); S=$?
check "non-file diagnostic mixed with baselined fails" 1 "$S" "$OUT" "without a file location"

# 14. U1: --write-baseline refuses on non-file diagnostics and keeps the file.
printf 'src/app/page.ts\tTS2304\n' > "$BASELINE"
cd "$REPO_ROOT" && env -i PATH="$TMP/bin:/usr/bin:/bin" HOME="$HOME" \
  TSC_BASELINE_FILE="$BASELINE" STUB_STATUS=1 STUB_OUTPUT="$GLOBAL_LINE" \
  bash "$WRAPPER" --write-baseline >/dev/null 2>&1
if grep -qF $'src/app/page.ts\tTS2304' "$BASELINE" && [ "$(grep -c . "$BASELINE")" -eq 1 ]; then
  echo "PASS: --write-baseline preserves the baseline on non-file diagnostics"
else
  echo "FAIL: --write-baseline overwrote the baseline on a non-file diagnostic"
  cat "$BASELINE"
  FAILURES=$((FAILURES + 1))
fi

if [ "$FAILURES" -gt 0 ]; then
  echo "$FAILURES self-test(s) failed"
  exit 1
fi
echo "All wrapper self-tests passed."
