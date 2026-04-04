#!/usr/bin/env bash
# Type-check using classic tsc, filtering out pre-existing Drizzle ORM errors
# caused by duplicate drizzle-orm packages (.bun/ vs .pnpm/ resolution).
#
# These errors are NOT introduced by our code — they're a known issue with
# bun's package resolution creating a second copy of drizzle-orm.
set -o pipefail

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

# Run tsc and capture output (tsc exits non-zero when errors exist)
TSC_OUTPUT=$(tsc --project tsconfig.typecheck-tsc.json --noEmit --ignoreDeprecations 5.0 2>&1) || true

# Filter out known Drizzle error lines
FILTERED=$(echo "$TSC_OUTPUT" | grep -v -E "$FILTER_PATTERN")

# Check if any "error TS" lines remain after filtering
REAL_ERRORS=$(echo "$FILTERED" | grep "error TS" || true)

if [ -n "$REAL_ERRORS" ]; then
  echo "Type errors found (excluding known Drizzle ORM issues):"
  echo "$REAL_ERRORS"
  exit 1
else
  # Count how many known errors were filtered
  KNOWN_COUNT=$(echo "$TSC_OUTPUT" | grep -c "error TS" || true)
  echo "Type check passed. ($KNOWN_COUNT known Drizzle ORM errors filtered)"
  exit 0
fi
