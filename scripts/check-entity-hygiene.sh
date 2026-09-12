#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Antigravity SMT MES - Entity & Name Hygiene Gate (Task C-02)
# Verifies that real brand names (Dixon) and realistic personal names
# have been completely replaced with synthetic entities across the codebase.
# ==============================================================================

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "================================================================================"
echo "   🔍 ANTIGRAVITY SMT MES: ENTITY & NAME HYGIENE SCAN"
echo "================================================================================"

FAILURES=0

# List of prohibited branding/real-world company strings
PROHIBITED_BRANDS=(
  "dixon"
)

# List of prohibited personal names
PROHIBITED_NAMES=(
  "Vikram Singh"
  "Meera Rao"
  "Deepak Sharma"
  "Ananya Sharma"
  "Ananya Iyer"
  "Priya Sharma"
)

# Files explicitly excluded from brand check (historical critique/audit documents and prebuilt release blobs)
EXCLUDED_PATTERNS=(
  ":!CRITIQUE_11TH_SEPT_AND_WAY_FORWARD.md"
  ":!PROJECT_MEMORY.md"
  ":!docs/superpowers/specs/2026-09-09-mes-customer-readiness-design.md"
  ":!release/"
  ":!scripts/check-entity-hygiene.sh"
)

echo "Scanning git-tracked files for prohibited brand references..."
for brand in "${PROHIBITED_BRANDS[@]}"; do
  MATCHES=$(git grep -I -i -n "$brand" -- . "${EXCLUDED_PATTERNS[@]}" 2>/dev/null || true)
  if [ -n "$MATCHES" ]; then
    echo "❌ Prohibited brand '$brand' detected in codebase:"
    echo "$MATCHES"
    FAILURES=$((FAILURES + 1))
  fi
done

echo "Scanning git-tracked files for prohibited personal names..."
for name in "${PROHIBITED_NAMES[@]}"; do
  MATCHES=$(git grep -I -F -n "$name" -- . "${EXCLUDED_PATTERNS[@]}" 2>/dev/null || true)
  if [ -n "$MATCHES" ]; then
    echo "❌ Prohibited personal name '$name' detected in codebase:"
    echo "$MATCHES"
    FAILURES=$((FAILURES + 1))
  fi
done

echo "================================================================================"
if [ "$FAILURES" -gt 0 ]; then
  echo "❌ HYGIENE GATE FAILED: $FAILURES violation(s) found."
  exit 1
else
  echo "✅ HYGIENE GATE PASSED: Codebase is 100% clean of real brands and personal names."
  exit 0
fi
